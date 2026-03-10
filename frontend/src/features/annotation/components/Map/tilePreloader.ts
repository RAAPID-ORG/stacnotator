/**
 * TilePreloader - fetches XYZ tiles into the browser cache so that when
 * OpenLayers later requests them they are instant cache-hits.
 *
 * Design:
 *   - Priority queue - lower number = higher priority.
 *   - Pause / resume - pauses while the active OL layer is loading.
 *   - Flat per-tile concurrency via fetch() + HTTP/2 multiplexing.
 *   - abort(groupId) / clear() for cancellation.
 */

import { createXYZ } from 'ol/tilegrid';
import { transformExtent } from 'ol/proj';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreloadJob {
  priority: number;
  groupId: string;
  /** Fully-resolved XYZ tile URL template (contains {z}, {x}, {y}). */
  urlTemplate: string;
  /** Map extent in EPSG:4326 [west, south, east, north]. */
  extent: [number, number, number, number];
  zoom: number;
}

// ---------------------------------------------------------------------------
// Tile coordinate utilities
// ---------------------------------------------------------------------------

const defaultGrid = createXYZ();

/**
 * Expand a URL template + extent + zoom into concrete tile URLs.
 */
export function tileUrlsForExtent(
  urlTemplate: string,
  extent: [number, number, number, number],
  zoom: number,
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
          .replace(/\{y\}/g, String(y)),
      );
    }
  }
  return urls;
}

/**
 * Probe a single tile URL to check if the slice has data at this location.
 * Returns true if the tile has actual imagery (HTTP 200), false for nodata
 * (204), errors (4xx/5xx), or network failures.
 */
export async function probeTile(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    await res.arrayBuffer();
    // 204 = No Content (nodata tile), treat as empty
    return res.status === 200;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// TilePreloader
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 50;
const DRAIN_INTERVAL_MS = 50;

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

  /** Fired when the queue is empty and nothing is in-flight. */
  onIdle?: () => void;

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
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.drain();
  }

  get isPaused() { return this.paused; }
  get queueSize() { return this.tileQueue.length; }

  abort(groupId: string) {
    this.tileQueue = this.tileQueue.filter((t) => t.groupId !== groupId);
  }

  clear() {
    this.tileQueue = [];
    this.generation++;
  }

  clearCache() {
    this.preloaded.clear();
  }

  dispose() {
    this.disposed = true;
    this.clear();
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private expandAndEnqueue(jobs: PreloadJob[]) {
    for (const job of jobs) {
      const urls = tileUrlsForExtent(job.urlTemplate, job.extent, job.zoom);
      for (const url of urls) {
        if (this.preloaded.has(url)) continue;
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
      this.fetchOne(tile);
    }
    this.checkIdle();
  }

  private fetchOne(tile: QueuedTile) {
    const gen = this.generation;
    this.inflight++;

    fetch(tile.url, { mode: 'cors', credentials: 'omit' })
      .then((res) => res.arrayBuffer().then(() => res.ok))
      .catch(() => false)
      .then(() => {
        this.inflight--;
        if (!this.disposed && gen === this.generation) this.drain();
        this.checkIdle();
      });
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
