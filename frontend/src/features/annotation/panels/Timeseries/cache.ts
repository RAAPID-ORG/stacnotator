import { getTimeseriesData, getZonalTimeseriesData } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { locationKey, type TimeseriesLocation } from '../../campaign/probes';

export type { LatLon } from '../../campaign/probes';

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

function position2d(position: GeoJSON.Position): [number, number] {
  if (position.length !== 2 || !position.every(Number.isFinite)) {
    throw new Error('Time-series coordinates must contain a finite longitude and latitude');
  }
  return [position[0], position[1]];
}

// Keyed by point AND the requested series, so two windows fetching different
// series at the same point don't share (and clobber) one entry.
function cacheKeyFor(
  campaignId: number,
  timeseriesIds: number[],
  coordinate: TimeseriesLocation
): string {
  const ids = [...timeseriesIds].sort((a, b) => a - b).join(',');
  return `${campaignId}|${locationKey(coordinate)}|${ids}`;
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

  private async fetchFromAPI(
    campaignId: number,
    timeseriesIds: number[],
    coordinate: TimeseriesLocation
  ): Promise<TimeSeriesData> {
    const results = await Promise.all(
      timeseriesIds.map(async (tsId) => {
        const path = { campaign_id: campaignId, timeseries_id: tsId };
        const { data } =
          'type' in coordinate
            ? await getZonalTimeseriesData({
                path,
                body: {
                  geometry:
                    coordinate.type === 'Polygon'
                      ? {
                          type: 'Polygon',
                          coordinates: coordinate.coordinates.map((ring) => ring.map(position2d)),
                        }
                      : {
                          type: 'MultiPolygon',
                          coordinates: coordinate.coordinates.map((polygon) =>
                            polygon.map((ring) => ring.map(position2d))
                          ),
                        },
                },
                throwOnError: true,
              })
            : await getTimeseriesData({
                path,
                query: { latitude: coordinate.lat, longitude: coordinate.lon },
                throwOnError: true,
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

  async get(
    campaignId: number,
    timeseriesIds: number[],
    coordinate: TimeseriesLocation | null
  ): Promise<TimeSeriesData | null> {
    if (!coordinate || timeseriesIds.length === 0) return null;

    const cacheKey = cacheKeyFor(campaignId, timeseriesIds, coordinate);

    const cached = this.cache.get(cacheKey);
    if (cached && this.isValid(cached)) return cached.data;

    const pending = this.pendingRequests.get(cacheKey);
    if (pending) return pending;

    const fetchPromise = (async () => {
      try {
        const data = await this.fetchFromAPI(campaignId, timeseriesIds, coordinate);
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
  prefetch(campaignId: number, timeseriesIds: number[], coordinates: TimeseriesLocation[]): void {
    for (const coordinate of coordinates) {
      if (!coordinate || timeseriesIds.length === 0) continue;

      const cacheKey = cacheKeyFor(campaignId, timeseriesIds, coordinate);
      const cached = this.cache.get(cacheKey);
      if ((cached && this.isValid(cached)) || this.pendingRequests.has(cacheKey)) continue;

      this.get(campaignId, timeseriesIds, coordinate).catch((err) => {
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
