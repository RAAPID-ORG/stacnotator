import { getTimeseriesData } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TimeSeriesRow {
  time: string;
  values: number;
  cloud: number;
}

export interface TimeSeriesData {
  [timeseriesId: number]: TimeSeriesRow[];
}

interface CacheEntry {
  data: TimeSeriesData;
  timestamp: number;
}

const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10; // keep last 10 locations

// Keyed by point AND the requested series, so two windows fetching different
// series at the same point don't share (and clobber) one entry.
function cacheKeyFor(timeseriesIds: number[], coordinate: LatLon): string {
  const ids = [...timeseriesIds].sort((a, b) => a - b).join(',');
  return `${coordinate.lat.toFixed(6)},${coordinate.lon.toFixed(6)}|${ids}`;
}

export class TimeSeriesCache {
  private cache = new Map<string, CacheEntry>();
  private pendingRequests = new Map<string, Promise<TimeSeriesData>>();

  constructor(private readonly now: () => number = Date.now) {}

  private isValid(entry: CacheEntry): boolean {
    return this.now() - entry.timestamp < CACHE_EXPIRY_MS;
  }

  private evictOldest(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (const [key] of entries.slice(0, this.cache.size - MAX_CACHE_SIZE)) {
      this.cache.delete(key);
    }
  }

  private async fetchFromAPI(timeseriesIds: number[], coordinate: LatLon): Promise<TimeSeriesData> {
    const results = await Promise.all(
      timeseriesIds.map(async (tsId) => {
        const { data } = await getTimeseriesData({
          path: { timeseries_id: tsId, latitude: coordinate.lat, longitude: coordinate.lon },
        });
        const rows: TimeSeriesRow[] = Array.isArray(data?.data)
          ? data.data.map((item) => ({
              time: String(item.time),
              values: Number(item.values),
              cloud: Number(item.cloud),
            }))
          : [];
        return { id: tsId, rows };
      })
    );

    return results.reduce<TimeSeriesData>((acc, { id, rows }) => {
      acc[id] = rows;
      return acc;
    }, {});
  }

  async get(timeseriesIds: number[], coordinate: LatLon | null): Promise<TimeSeriesData | null> {
    if (!coordinate || timeseriesIds.length === 0) return null;

    const cacheKey = cacheKeyFor(timeseriesIds, coordinate);

    const cached = this.cache.get(cacheKey);
    if (cached && this.isValid(cached)) return cached.data;

    const pending = this.pendingRequests.get(cacheKey);
    if (pending) return pending;

    const fetchPromise = (async () => {
      try {
        const data = await this.fetchFromAPI(timeseriesIds, coordinate);
        this.cache.set(cacheKey, { data, timestamp: this.now() });
        this.evictOldest();
        return data;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /** Prefetch data for upcoming locations (fire-and-forget). A failed
   *  prefetch just means that point re-fetches on demand when the user
   *  actually reaches it, so failures are logged, not surfaced. */
  prefetch(timeseriesIds: number[], coordinates: LatLon[]): void {
    for (const coordinate of coordinates) {
      if (!coordinate || timeseriesIds.length === 0) continue;

      const cacheKey = cacheKeyFor(timeseriesIds, coordinate);
      const cached = this.cache.get(cacheKey);
      if ((cached && this.isValid(cached)) || this.pendingRequests.has(cacheKey)) continue;

      this.get(timeseriesIds, coordinate).catch((err) => {
        handleError(err, `Prefetch failed for ${cacheKey}`, { showUser: false });
      });
    }
  }

  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}

export const timeSeriesCache = new TimeSeriesCache();
