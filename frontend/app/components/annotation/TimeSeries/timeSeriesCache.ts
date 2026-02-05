/**
 * Time series data cache with prefetching support
 * 
 * Critical for performance: Time series fetches take ~10 seconds per point.
 * This cache prevents redundant fetches and enables prefetching for smooth UX.
 */

import { getTimeseriesData } from '~/api/client';
import type { LatLon } from '~/utils/utility';

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
const MAX_CACHE_SIZE = 10; // Keep last 10 locations

class TimeSeriesCache {
  private cache = new Map<string, CacheEntry>();
  private pendingRequests = new Map<string, Promise<TimeSeriesData>>();

  private getCacheKey(coordinate: LatLon): string {
    return `${coordinate.lat.toFixed(6)},${coordinate.lon.toFixed(6)}`;
  }

  private isValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < CACHE_EXPIRY_MS;
  }

  private evictOldest(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) return;

    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, this.cache.size - MAX_CACHE_SIZE);
    toRemove.forEach(([key]) => this.cache.delete(key));
  }

  private async fetchFromAPI(
    timeseriesIds: number[],
    coordinate: LatLon
  ): Promise<TimeSeriesData> {
    const results = await Promise.all(
      timeseriesIds.map(async (tsId) => {
        const { data } = await getTimeseriesData({
          path: {
            timeseries_id: tsId,
            latitude: coordinate.lat,
            longitude: coordinate.lon,
          },
        });

        return {
          id: tsId,
          rows: Array.isArray(data!.data)
            ? (data!.data.map((item) => ({
                time: String(item.time),
                values: Number(item.values),
                cloud: Number(item.cloud),
              })) as TimeSeriesRow[])
            : [],
        };
      })
    );

    return results.reduce<TimeSeriesData>((acc, { id, rows }) => {
      acc[id] = rows;
      return acc;
    }, {});
  }

  async get(
    timeseriesIds: number[],
    coordinate: LatLon | null
  ): Promise<TimeSeriesData | null> {
    if (!coordinate || timeseriesIds.length === 0) {
      return null;
    }

    const cacheKey = this.getCacheKey(coordinate);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && this.isValid(cached)) {
      return cached.data;
    }

    // Check if already fetching (request deduplication)
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    // Start new fetch
    const fetchPromise = (async () => {
      try {
        const data = await this.fetchFromAPI(timeseriesIds, coordinate);

        this.cache.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });
        this.evictOldest();

        return data;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Prefetch data for upcoming locations (fire-and-forget)
   */
  prefetch(timeseriesIds: number[], coordinates: LatLon[]): void {
    coordinates.forEach((coordinate) => {
      if (!coordinate || timeseriesIds.length === 0) return;

      const cacheKey = this.getCacheKey(coordinate);
      const cached = this.cache.get(cacheKey);

      // Skip if already cached/valid or already fetching
      if ((cached && this.isValid(cached)) || this.pendingRequests.has(cacheKey)) {
        return;
      }

      // Start fetch in background
      this.get(timeseriesIds, coordinate).catch((err) => {
        console.warn(`Prefetch failed for ${cacheKey}:`, err);
      });
    });
  }

  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}

export const timeSeriesCache = new TimeSeriesCache();
