import { getTimeseriesData } from '~/api/client';

interface TimeSeriesRow {
  time: string;
  values: number;
  cloud: number;
}

interface CacheEntry {
  data: { [key: number]: TimeSeriesRow[] };
  timestamp: number;
}

interface CacheKey {
  lat: number;
  lon: number;
}

/**
 * Cache for timeseries data with prefetching support
 * Stores data by lat/lon coordinates to avoid redundant API calls
 */
class TimeSeriesCache {
  private cache: Map<string, CacheEntry> = new Map();
  private pendingRequests: Map<string, Promise<{ [key: number]: TimeSeriesRow[] }>> = new Map();
  private maxCacheSize = 10; // Keep last 10 locations
  private cacheExpiryMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Generate cache key from coordinates
   */
  private getCacheKey(lat: number, lon: number): string {
    return `${lat.toFixed(6)},${lon.toFixed(6)}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < this.cacheExpiryMs;
  }

  /**
   * Evict oldest entries if cache exceeds max size
   */
  private evictOldest(): void {
    if (this.cache.size <= this.maxCacheSize) return;

    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, this.cache.size - this.maxCacheSize);
    toRemove.forEach(([key]) => this.cache.delete(key));
  }

  /**
   * Fetch timeseries data for a location
   */
  private async fetchData(
    timeseriesIds: number[],
    lat: number,
    lon: number
  ): Promise<{ [key: number]: TimeSeriesRow[] }> {
    const cacheKey = this.getCacheKey(lat, lon);

    // Check if already fetching this location
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    // Start new fetch
    const fetchPromise = (async () => {
      try {
        const results = await Promise.all(
          timeseriesIds.map(async (tsId) => {
            const { data } = await getTimeseriesData({
              path: {
                timeseries_id: tsId,
                latitude: lat,
                longitude: lon,
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

        const dict = results.reduce<{ [key: number]: TimeSeriesRow[] }>((acc, { id, rows }) => {
          acc[id] = rows;
          return acc;
        }, {});

        // Store in cache
        this.cache.set(cacheKey, {
          data: dict,
          timestamp: Date.now(),
        });
        this.evictOldest();

        return dict;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Get timeseries data for a location, using cache if available
   * @returns Promise that resolves to the data, or null if coordinates are invalid
   */
  async get(
    timeseriesIds: number[],
    lat: number | null,
    lon: number | null
  ): Promise<{ [key: number]: TimeSeriesRow[] } | null> {
    if (lat === null || lon === null || timeseriesIds.length === 0) {
      return null;
    }

    const cacheKey = this.getCacheKey(lat, lon);
    const cached = this.cache.get(cacheKey);

    // Return cached data if valid
    if (cached && this.isValid(cached)) {
      return cached.data;
    }

    // Fetch new data
    return this.fetchData(timeseriesIds, lat, lon);
  }

  /**
   * Prefetch timeseries data for a location without blocking
   * Used to warm the cache for upcoming tasks
   */
  prefetch(timeseriesIds: number[], lat: number | null, lon: number | null): void {
    if (lat === null || lon === null || timeseriesIds.length === 0) {
      return;
    }

    const cacheKey = this.getCacheKey(lat, lon);
    const cached = this.cache.get(cacheKey);

    // Skip if already cached and valid, or already fetching
    if ((cached && this.isValid(cached)) || this.pendingRequests.has(cacheKey)) {
      return;
    }

    // Start fetch in background (don't await)
    this.fetchData(timeseriesIds, lat, lon).catch((err) => {
      console.warn(`Prefetch failed for ${cacheKey}:`, err);
    });
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Get cache statistics (useful for debugging)
   */
  getStats(): { size: number; pending: number } {
    return {
      size: this.cache.size,
      pending: this.pendingRequests.size,
    };
  }
}

// Export singleton instance
export const timeseriesCache = new TimeSeriesCache();
export type { TimeSeriesRow };
