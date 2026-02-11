import L from 'leaflet';

// ── Global tile request rate limiter (token-bucket style) ────────────────────
// Shared across *all* RateLimitedTileLayer instances so the total outgoing
// tile request rate is bounded regardless of how many Leaflet maps are on
// screen at the same time.

const MAX_CONCURRENT_REQUESTS = 12; // max simultaneous in-flight tile fetches
const MAX_REQUESTS_PER_SECOND = 40; // sustained rate cap

interface QueueEntry {
  execute: () => void;
}

class TileRateLimiter {
  private queue: QueueEntry[] = [];
  private inFlight = 0;
  private tokenBucket: number;
  private readonly maxTokens: number;
  private refillTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxConcurrent: number, maxPerSecond: number) {
    this.maxTokens = maxConcurrent;
    this.tokenBucket = maxConcurrent;

    // Refill tokens at the desired rate
    const refillInterval = 1000 / maxPerSecond;
    this.refillTimer = setInterval(() => {
      if (this.tokenBucket < this.maxTokens) {
        this.tokenBucket++;
        this.drain();
      }
    }, refillInterval);
  }

  /** Enqueue a tile fetch. Returns immediately; the fetch will run when a slot is available. */
  enqueue(fn: () => void): void {
    this.queue.push({ execute: fn });
    this.drain();
  }

  /** Called when a tile fetch completes (success or failure). */
  release(): void {
    this.inFlight--;
    this.tokenBucket = Math.min(this.tokenBucket + 1, this.maxTokens);
    this.drain();
  }

  private drain(): void {
    while (this.queue.length > 0 && this.inFlight < this.maxTokens && this.tokenBucket > 0) {
      const entry = this.queue.shift();
      if (entry) {
        this.inFlight++;
        this.tokenBucket--;
        entry.execute();
      }
    }
  }

  /** Remove all pending entries (useful when tile layers are removed) */
  clear(): void {
    this.queue = [];
  }

  destroy(): void {
    this.clear();
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
  }
}

/** Singleton - shared by every RateLimitedTileLayer on the page */
export const globalTileLimiter = new TileRateLimiter(
  MAX_CONCURRENT_REQUESTS,
  MAX_REQUESTS_PER_SECOND,
);

// ── Retry helpers ────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 300; // 300ms, 600ms, 1200ms, 2400ms, 4800ms

function retryDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt);
}

// ── SVG data-URI for hatched "no content" tile ───────────────────────────────

const NO_CONTENT_TILE_SVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <defs>
    <pattern id="h" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(150,150,150,0.35)" stroke-width="1.5"/>
    </pattern>
  </defs>
  <rect width="256" height="256" fill="rgba(200,200,200,0.15)"/>
  <rect width="256" height="256" fill="url(#h)"/>
</svg>`);

const NO_CONTENT_DATA_URI = `data:image/svg+xml,${NO_CONTENT_TILE_SVG}`;

// ── Custom TileLayer ─────────────────────────────────────────────────────────
//
// Strategy:
//   We use the standard <img>.src approach for actually loading tiles (this
//   avoids CORS issues that arise with fetch() against third-party tile
//   servers). The rate limiter controls *when* each tile starts loading.
//
//   To detect HTTP 204 "No Content" we first do a lightweight HEAD request.
//   • HEAD 204         → show hatched "no content" tile immediately.
//   • HEAD succeeds    → proceed to load the tile image normally.
//   • HEAD fails / !ok → retry with exponential backoff (network or server error).
//
//   If the HEAD succeeds but the <img> still fails to render, that also
//   triggers the retry path (via the img error event).

export const RateLimitedTileLayer = L.TileLayer.extend({
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img') as HTMLImageElement;

    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    // Crossorigin - respect the option if set, otherwise leave it unset
    // so that plain <img> loads work against servers without CORS headers.
    if (this.options.crossOrigin || this.options.crossOrigin === '') {
      tile.crossOrigin = this.options.crossOrigin;
    }

    // Build the URL from the standard template
    const url = this.getTileUrl(coords);

    // Kick off the rate-limited, retrying load
    this._loadTileWithRetry(tile, url, 0, done);

    return tile;
  },

  _loadTileWithRetry(
    tile: HTMLImageElement,
    url: string,
    attempt: number,
    done: L.DoneCallback,
  ): void {
    globalTileLimiter.enqueue(() => {
      // If the tile element has been removed from the DOM (e.g. layer removed
      // while queued), abort early so we don't waste a request.
      if (!tile.parentNode && attempt > 0) {
        globalTileLimiter.release();
        return;
      }

      // ── Step 1: Lightweight HEAD request to check for 204 ──────────
      // We use no-cors as a fallback: if the server doesn't support CORS
      // the HEAD will get an opaque response and we just skip the 204
      // check and load the tile directly.
      const controller = new AbortController();
      const headTimeout = setTimeout(() => controller.abort(), 5000);

      fetch(url, { method: 'HEAD', signal: controller.signal })
        .then((response) => {
          clearTimeout(headTimeout);
          globalTileLimiter.release();

          if (response.status === 204) {
            // No content - show the hatched placeholder
            tile.src = NO_CONTENT_DATA_URI;
            tile.classList.add('leaflet-tile-no-content');
            done(undefined, tile);
            return;
          }

          if (response.ok || response.type === 'opaque') {
            // Server has content (or we can't tell due to opaque response)
            // → load the image the standard way via <img>.src
            this._loadImageSrc(tile, url, attempt, done);
            return;
          }

          // Non-ok, non-204 → treat as error for retry
          throw new Error(`HTTP ${response.status}`);
        })
        .catch(() => {
          clearTimeout(headTimeout);
          globalTileLimiter.release();

          // HEAD failed (network, CORS, abort, etc.)
          // Fall back to loading the tile directly via <img>.src.
          // If the image also fails, _loadImageSrc will handle retry.
          this._loadImageSrc(tile, url, attempt, done);
        });
    });
  },

  /**
   * Standard <img>.src tile loading with error-based retry.
   */
  _loadImageSrc(
    tile: HTMLImageElement,
    url: string,
    attempt: number,
    done: L.DoneCallback,
  ): void {
    // Clean up any previous handlers
    tile.onload = null;
    tile.onerror = null;

    tile.onload = () => {
      done(undefined, tile);
    };

    tile.onerror = () => {
      if (attempt < MAX_RETRIES) {
        const delay = retryDelay(attempt);
        setTimeout(() => {
          this._loadTileWithRetry(tile, url, attempt + 1, done);
        }, delay);
      } else {
        console.warn(`[TileLayer] Tile failed after ${MAX_RETRIES} retries: ${url}`);
        tile.src = NO_CONTENT_DATA_URI;
        tile.classList.add('leaflet-tile-error');
        done(new Error(`Tile load failed: ${url}`), tile);
      }
    };

    tile.src = url;
  },
}) as unknown as new (urlTemplate: string, options?: L.TileLayerOptions) => L.TileLayer;

/**
 * Factory function - drop-in replacement for `L.tileLayer(url, options)`.
 *
 * ```ts
 * import { rateLimitedTileLayer } from '~/shared/utils/RateLimitedTileLayer';
 * rateLimitedTileLayer(url, options).addTo(map);
 * ```
 */
export function rateLimitedTileLayer(
  urlTemplate: string,
  options?: L.TileLayerOptions,
): L.TileLayer {
  return new RateLimitedTileLayer(urlTemplate, options);
}
