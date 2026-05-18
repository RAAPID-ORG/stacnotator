/**
 * TilePreloader - loads XYZ tiles via <img> elements into the browser cache
 * so that when OpenLayers later requests them they are instant cache-hits.
 *
 * Uses <img> (not fetch()) because OL loads tiles via <img crossOrigin="anonymous">.
 * Both must use the same request mechanism to share the browser's HTTP cache
 * partition - mixing fetch() and <img> causes intermittent gray tiles.
 *
 * Design:
 *   - Priority queue - lower number = higher priority.
 *   - Pause / resume - pauses while the active OL layer is loading.
 *   - Flat per-tile concurrency via <img> elements.
 *   - abort(groupId) / clear() for cancellation.
 *   - Per-group empty-tile detection: if EMPTY_TILE_THRESHOLD errors
 *     occur with zero successes for a group, onGroupEmpty fires and
 *     the group is auto-aborted (empty slice case).
 */

import { createXYZ } from 'ol/tilegrid';
import { transformExtent } from 'ol/proj';
import { getTilerToken } from '~/api/tilerToken';
import { isSelfHostedUrl } from '../../utils/tileLoading';

// Num consecutive tile-load errs to consider group (slice) empty/nodata.
export const EMPTY_TILE_THRESHOLD = 4;

export interface PreloadJob {
  priority: number;
  groupId: string;
  urlTemplate: string; // Fully-resolved XYZ tile URL template (contains {z}, {x}, {y}).
  extent: [number, number, number, number]; // Map extent in EPSG:4326 [west, south, east, north].
  zoom: number;
}

const defaultGrid = createXYZ();

// Expand a URL template + extent + zoom into concrete tile URLs.
export function tileUrlsForExtent(
  urlTemplate: string,
  extent: [number, number, number, number],
  zoom: number
): string[] {
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
}

export class TilePreloader {
  private tileQueue: QueuedTile[] = [];
  private inflight = 0;
  private paused = false;
  private disposed = false;
  private generation = 0;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxConcurrent: number;
  private preloaded = new Set<string>();

  // Cancel functions for in-flight <img> loads.
  private inflightCancels = new Set<() => void>();

  // Per-group error/success counters for empty-tile detection.
  private groupStats = new Map<
    string,
    { errors: number; successes: number; emptyFired: boolean }
  >();

  // Fired when the queue is empty and nothing is in-flight.
  onIdle?: () => void;

  /**
   * Fired when a group accumulates EMPTY_TILE_THRESHOLD errors with zero
   * successes - same heuristic as WindowMap's tileloaderror counting.
   * The group is auto-aborted after this fires.
   */
  onGroupEmpty?: (groupId: string) => void;

  constructor(maxConcurrent = MAX_CONCURRENT) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue(job: PreloadJob) {
    this.expandAndEnqueue([job]);
    this.drain();
  }

  enqueueMany(jobs: PreloadJob[]) {
    this.expandAndEnqueue(jobs);
    this.drain();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    // Deliberately do NOT _abortInflight() here. Chromium coalesces concurrent
    // <img> loads for the same URL into a single underlying fetch, so canceling
    // a preloader img also cancels OL's tile <img> for that URL - OL then marks
    // the tile TileState.ERROR permanently and the user sees a stuck gray tile.
    // drain()'s `if (this.paused) return` already blocks new starts, which is
    // all pause() needs to do. Let in-flight drain naturally.
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.drain();
  }

  get isPaused() {
    return this.paused;
  }
  get queueSize() {
    return this.tileQueue.length;
  }

  abort(groupId: string) {
    this.tileQueue = this.tileQueue.filter((t) => t.groupId !== groupId);
    this.groupStats.delete(groupId);
  }

  // Abort all queued tiles whose groupId starts with the given prefix.
  // Useful for selectively clearing e.g. all current-task or next-task groups.
  abortByPrefix(prefix: string) {
    this.tileQueue = this.tileQueue.filter((t) => !t.groupId.startsWith(prefix));
    for (const key of this.groupStats.keys()) {
      if (key.startsWith(prefix)) this.groupStats.delete(key);
    }
  }

  clear() {
    this.tileQueue = [];
    this.groupStats.clear();
    this.generation++;
    // Deliberately do NOT _abortInflight() here. See pause() for the full
    // reason: Chromium coalesces same-URL <img> fetches, so aborting a preloader
    // img also aborts any OL tile img sharing that fetch, putting the OL tile
    // into terminal TileState.ERROR. The generation++ above makes loadOne()'s
    // done() callback a no-op for stale completions, so in-flight drain
    // naturally without polluting our bookkeeping.
  }

  clearCache() {
    this.preloaded.clear();
    this.groupStats.clear();
  }

  dispose() {
    this.disposed = true;
    this.clear();
    // On unmount it is safe (and desirable) to drop any remaining in-flight
    // loads - there is no OL map left to share them with.
    this._abortInflight();
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private expandAndEnqueue(jobs: PreloadJob[]) {
    for (const job of jobs) {
      // Initialize group stats if this is a new group
      if (!this.groupStats.has(job.groupId)) {
        this.groupStats.set(job.groupId, { errors: 0, successes: 0, emptyFired: false });
      }

      const urls = tileUrlsForExtent(job.urlTemplate, job.extent, job.zoom);
      for (const url of urls) {
        if (this.preloaded.has(url)) continue;
        // Evict cache when it gets too large (browser HTTP cache still has the tiles)
        if (this.preloaded.size >= MAX_PRELOADED_CACHE) {
          this.preloaded.clear();
        }
        this.preloaded.add(url);
        this.tileQueue.push({ url, priority: job.priority, groupId: job.groupId });
      }
    }
    this.tileQueue.sort((a, b) => a.priority - b.priority);
  }

  private drain() {
    if (this.disposed) return;
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => this.drain(), DRAIN_INTERVAL_MS);
    }
    if (this.paused) return;

    while (this.inflight < this.maxConcurrent && this.tileQueue.length > 0) {
      const tile = this.tileQueue.shift()!;
      this.loadOne(tile);
    }
    this.checkIdle();
  }

  private loadOne(tile: QueuedTile) {
    const gen = this.generation;
    this.inflight++;

    const done = (ok: boolean, cancelled = false) => {
      this.inflight = Math.max(0, this.inflight - 1);

      if (cancelled || this.disposed || gen !== this.generation) {
        this.drain();
        this.checkIdle();
        return;
      }

      // Per-group empty-tile detection (mirrors WindowMap's heuristic)
      const stats = this.groupStats.get(tile.groupId);
      if (stats && !stats.emptyFired) {
        if (ok) {
          stats.successes++;
        } else {
          stats.errors++;
          if (stats.successes === 0 && stats.errors >= EMPTY_TILE_THRESHOLD) {
            stats.emptyFired = true;
            this.abort(tile.groupId);
            this.onGroupEmpty?.(tile.groupId);
          }
        }
      }

      if (!this.disposed && gen === this.generation) this.drain();
      this.checkIdle();
    };

    const startImg = (url: string) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      // Low priority so the browser/server scheduler keeps bandwidth and
      // HTTP/2 stream priority free for user-initiated active-layer tiles
      // (which set fetchPriority='high' in tileLoadImagery).
      img.fetchPriority = 'low';
      let settled = false;

      const cancel = () => {
        if (!settled) {
          settled = true;
          img.onload = img.onerror = null;
          img.src = '';
          this.inflightCancels.delete(cancel);
          done(false, true);
        }
      };
      this.inflightCancels.add(cancel);

      img.onload = () => {
        if (settled) return;
        settled = true;
        this.inflightCancels.delete(cancel);
        done(true);
      };
      img.onerror = () => {
        if (settled) return;
        settled = true;
        this.inflightCancels.delete(cancel);
        done(false);
      };
      img.src = url;
    };

    // Self-hosted tiles need an auth token appended to the URL
    if (isSelfHostedUrl(tile.url)) {
      getTilerToken()
        .then((token) => {
          if (this.disposed || gen !== this.generation) {
            done(false, true);
            return;
          }
          const sep = tile.url.includes('?') ? '&' : '?';
          startImg(`${tile.url}${sep}token=${encodeURIComponent(token)}`);
        })
        .catch(() => done(false));
    } else {
      startImg(tile.url);
    }
  }

  // Cancel all in-flight <img> loads.
  private _abortInflight() {
    for (const cancel of this.inflightCancels) {
      cancel();
    }
    this.inflightCancels.clear();
    this.inflight = 0;
  }

  private checkIdle() {
    if (this.tileQueue.length === 0 && this.inflight === 0) {
      if (this.drainTimer) {
        clearInterval(this.drainTimer);
        this.drainTimer = null;
      }
      this.onIdle?.();
    }
  }
}
