import { createXYZ } from 'ol/tilegrid';
import { transformExtent } from 'ol/proj';
import type { Bbox } from '~/shared/map/types';
import { crossOriginForTile, ensureSessionFor, type CrossOrigin } from '~/shared/map/tileLoading';

export interface PreloadJob {
  priority: number;
  groupId: string;
  urlTemplate: string; // Fully-resolved XYZ tile URL template (contains {z}, {x}, {y}).
  extent: Bbox;
  zoom: number;
  tileProvider?: string | null; // "mpc" / tiler name / null - drives crossOrigin + cookie.
}

/** The slice of HTMLImageElement the preloader drives; injectable so tests stay headless. */
export interface PreloadImage {
  crossOrigin: string | null;
  fetchPriority: 'high' | 'low' | 'auto';
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export interface PreloaderOptions {
  maxConcurrent?: number;
  createImage?: () => PreloadImage;
}

const defaultGrid = createXYZ();

/** Expand a URL template + extent + zoom into concrete tile URLs. */
export function tileUrlsForExtent(urlTemplate: string, extent: Bbox, zoom: number): string[] {
  const mercExtent = transformExtent(extent, 'EPSG:4326', 'EPSG:3857');
  const z = Math.round(zoom);
  const tileRange = defaultGrid.getTileRangeForExtentAndZ(mercExtent, z);
  if (!tileRange) return [];

  const urls: string[] = [];
  for (let x = tileRange.minX; x <= tileRange.maxX; x++) {
    for (let y = tileRange.minY; y <= tileRange.maxY; y++) {
      urls.push(
        urlTemplate
          .replace(/\{z\}/g, String(z))
          .replace(/\{x\}/g, String(x))
          .replace(/\{y\}/g, String(y))
      );
    }
  }
  return urls;
}

const MAX_CONCURRENT = 50;
const DRAIN_INTERVAL_MS = 50;
const MAX_PRELOADED_CACHE = 5000;

interface QueuedTile {
  url: string;
  priority: number;
  groupId: string;
  crossOrigin: CrossOrigin;
}

/** How much of one group's neighbourhood is already in the browser cache. */
export interface GroupProgress {
  done: number;
  total: number;
}

export class TilePreloader {
  private tileQueue: QueuedTile[] = [];
  private groups = new Map<string, GroupProgress>();
  private inflight = 0;
  private paused = false;
  private disposed = false;
  private generation = 0;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private preloaded = new Set<string>();
  private inflightCancels = new Map<() => void, string>();

  private readonly maxConcurrent: number;
  private readonly createImage: () => PreloadImage;

  /** Fired when the queue is empty and nothing is in-flight. */
  onIdle?: () => void;

  /** Fired whenever a group's counts move, so a UI can follow the warm-up. */
  onProgress?: () => void;

  constructor(options: PreloaderOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT;
    // HTMLImageElement's handler signatures are wider than PreloadImage needs.
    this.createImage = options.createImage ?? (() => new Image() as unknown as PreloadImage);
  }

  enqueue(job: PreloadJob): void {
    this.expandAndEnqueue([job]);
    this.drain();
  }

  enqueueMany(jobs: PreloadJob[]): void {
    this.expandAndEnqueue(jobs);
    this.drain();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    // Deliberately do NOT abortInflight() here. Chromium coalesces concurrent
    // <img> loads for the same URL into a single underlying fetch, so canceling
    // a preloader img also cancels OL's tile <img> for that URL - OL then marks
    // the tile TileState.ERROR permanently and the user sees a stuck gray tile.
    // drain()'s `if (this.paused) return` already blocks new starts, which is
    // all pause() needs to do. Let in-flight drain naturally.
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.drain();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get queueSize(): number {
    return this.tileQueue.length;
  }

  /** Per-group tile counts. Aborted work is written off the total rather than
   *  left pending, so a group a caller gave up on still reads as complete. */
  progress(): Map<string, GroupProgress> {
    const snapshot = new Map<string, GroupProgress>();
    for (const [groupId, counts] of this.groups) snapshot.set(groupId, { ...counts });
    return snapshot;
  }

  abort(groupId: string): void {
    this.dropQueued((t) => t.groupId === groupId);
  }

  /** Drop every queued tile whose groupId starts with the prefix (e.g. all next-task groups). */
  abortByPrefix(prefix: string): void {
    this.dropQueued((t) => t.groupId.startsWith(prefix));
  }

  clear(): void {
    // Queued tiles were never actually requested, so they leave the warm set
    // with the queue. Without this they would come back counted as done the
    // next time the same neighbourhood is enqueued - which is what made the
    // upcoming-task bars jump to full on any change of date or collection.
    this.forgetQueued(this.tileQueue);
    this.tileQueue = [];
    this.groups.clear();
    this.generation++;
    // Deliberately do NOT abortInflight() here. See pause() for the full reason:
    // Chromium coalesces same-URL <img> fetches, so aborting a preloader img also
    // aborts any OL tile img sharing that fetch, putting the OL tile into terminal
    // TileState.ERROR. The generation++ above makes loadOne()'s done() callback a
    // no-op for stale completions, so in-flight loads drain naturally without
    // polluting our bookkeeping.
    this.onProgress?.();
  }

  clearCache(): void {
    this.preloaded.clear();
  }

  /**
   * Cancel speculative work that cannot serve the new foreground viewport.
   * URLs the active OL layers may share are deliberately preserved: Chromium
   * coalesces equal image requests, so aborting one of those also fails OL's.
   */
  cancelInflightExcept(keepUrls: ReadonlySet<string>): void {
    for (const [cancel, url] of this.inflightCancels) {
      if (!keepUrls.has(url)) cancel();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    // On unmount it is safe (and desirable) to drop any remaining in-flight loads -
    // there is no OL map left to share them with.
    this.abortInflight();
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private expandAndEnqueue(jobs: PreloadJob[]): void {
    for (const job of jobs) {
      const crossOrigin = crossOriginForTile(job.urlTemplate, job.tileProvider);
      const counts = this.countsFor(job.groupId);
      for (const url of tileUrlsForExtent(job.urlTemplate, job.extent, job.zoom)) {
        counts.total++;
        // Already fetched this cycle: the tile is warm, so it counts towards the
        // group rather than disappearing from it, and is not requested twice.
        if (this.preloaded.has(url)) {
          counts.done++;
          continue;
        }
        // Evict when the seen-set grows unbounded; the browser HTTP cache still has the tiles.
        if (this.preloaded.size >= MAX_PRELOADED_CACHE) this.preloaded.clear();
        this.preloaded.add(url);
        this.tileQueue.push({ url, priority: job.priority, groupId: job.groupId, crossOrigin });
      }
    }
    this.tileQueue.sort((a, b) => a.priority - b.priority);
    this.onProgress?.();
  }

  private countsFor(groupId: string): GroupProgress {
    let counts = this.groups.get(groupId);
    if (!counts) {
      counts = { done: 0, total: 0 };
      this.groups.set(groupId, counts);
    }
    return counts;
  }

  private dropQueued(matches: (tile: QueuedTile) => boolean): void {
    const kept: QueuedTile[] = [];
    const dropped: QueuedTile[] = [];
    for (const tile of this.tileQueue) {
      if (matches(tile)) {
        this.countsFor(tile.groupId).total--;
        dropped.push(tile);
      } else kept.push(tile);
    }
    this.forgetQueued(dropped);
    this.tileQueue = kept;
    this.onProgress?.();
  }

  /** Take tiles that never left the queue back out of the warm set: nothing
   *  fetched them, so nothing may report them as fetched. */
  private forgetQueued(tiles: readonly QueuedTile[]): void {
    for (const tile of tiles) this.preloaded.delete(tile.url);
  }

  private drain(): void {
    if (this.disposed) return;
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => this.drain(), DRAIN_INTERVAL_MS);
    }
    if (this.paused) return;

    while (this.inflight < this.maxConcurrent && this.tileQueue.length > 0) {
      this.loadOne(this.tileQueue.shift()!);
    }
    this.checkIdle();
  }

  private loadOne(tile: QueuedTile): void {
    const gen = this.generation;
    this.inflight++;

    const done = (cancelled = false) => {
      this.inflight = Math.max(0, this.inflight - 1);
      // A stale generation's counters were already discarded by clear(); a
      // cancelled tile is never coming, so it counts as settled either way.
      if (gen === this.generation) {
        this.countsFor(tile.groupId).done++;
        this.onProgress?.();
      }

      if (cancelled || this.disposed || gen !== this.generation) {
        this.drain();
        this.checkIdle();
        return;
      }

      if (!this.disposed && gen === this.generation) this.drain();
      this.checkIdle();
    };

    const startImg = (url: string) => {
      const img = this.createImage();
      img.crossOrigin = tile.crossOrigin;
      // Low priority so the browser/server scheduler keeps bandwidth and HTTP/2 stream
      // priority free for user-initiated active-layer tiles (which request at 'high').
      img.fetchPriority = 'low';
      let settled = false;

      const cancel = () => {
        if (settled) return;
        settled = true;
        img.onload = img.onerror = null;
        img.src = '';
        this.inflightCancels.delete(cancel);
        // Never fetched, so it must not stay in the warm set claiming otherwise.
        this.preloaded.delete(url);
        done(true);
      };
      this.inflightCancels.set(cancel, url);

      img.onload = () => {
        if (settled) return;
        settled = true;
        this.inflightCancels.delete(cancel);
        done();
      };
      img.onerror = () => {
        if (settled) return;
        settled = true;
        this.inflightCancels.delete(cancel);
        done();
      };
      img.src = url;
    };

    // Refresh the tiler cookie first for our-tiler tiles (no-op for MPC/public), then load.
    ensureSessionFor(tile.crossOrigin)
      .then(() => {
        if (this.disposed || gen !== this.generation) {
          done(true);
          return;
        }
        startImg(tile.url);
      })
      .catch(() => done());
  }

  private abortInflight(): void {
    for (const cancel of this.inflightCancels.keys()) cancel();
    this.inflightCancels.clear();
    this.inflight = 0;
  }

  private checkIdle(): void {
    if (this.tileQueue.length > 0 || this.inflight > 0) return;
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    this.onIdle?.();
  }
}
