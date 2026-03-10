import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { stacRegistrationLimiter } from '~/shared/utils/concurrencyLimiter';
import { computeTimeSlices } from '~/shared/utils/utility';
import type { ImageryWithWindowsOut } from '~/api/client';


/** Map from `{windowId}-{sliceIndex}` -> searchId */
export type SliceLayerMap = Map<string, string>;

// Module-level cache -survives re-renders and component remounts.

const registrationCache = new Map<string, string>();

function cacheKey(
  registrationUrl: string,
  bbox: [number, number, number, number],
  searchBody: Record<string, unknown>,
  startDate: string,
  endDate: string,
): string {
  return `${registrationUrl}|${bbox.join(',')}|${JSON.stringify(searchBody)}|${startDate}|${endDate}`;
}

// Single-slice registration (with cache + concurrency limiting)

async function registerSlice(
  registrationUrl: string,
  searchBody: Record<string, unknown>,
  bbox: [number, number, number, number],
  startDate: string,
  endDate: string,
): Promise<string> {
  const key = cacheKey(registrationUrl, bbox, searchBody, startDate, endDate);
  if (registrationCache.has(key)) return registrationCache.get(key)!;

  const raw = JSON.stringify({ ...searchBody, bbox });
  const filled = raw
    .replace(/\{startDatetimePlaceholder\}/g, startDate)
    .replace(/\{endDatetimePlaceholder\}/g, endDate);

  const response = await stacRegistrationLimiter.execute(() =>
    axios.post(registrationUrl, JSON.parse(filled)),
  );

  const searchId =
    response.data?.searchId ?? response.data?.searchid ?? response.data?.search_id;
  if (!searchId) throw new Error('No searchId returned from registration endpoint');

  registrationCache.set(key, searchId);
  return searchId;
}

// Hook
interface UseStacRegistrationParams {
  imagery: ImageryWithWindowsOut | null;
  bbox: [number, number, number, number];
  enabled?: boolean;
}

export interface UseStacRegistrationResult {
  /** Resolved tile-URL map -set once when ALL registrations finish. */
  sliceLayerMap: SliceLayerMap;
  /** True once every slice has been registered (or was cached). */
  allRegistered: boolean;
}

/**
 * Registers STAC mosaic search IDs for every window × every slice,
 * all in parallel (concurrency-limited). Returns the resolved tile
 * URLs all at once after every registration finishes.
 *
 * Results are cached at module level so re-mounts never re-register.
 */
export function useStacRegistration({
  imagery,
  bbox,
  enabled = true,
}: UseStacRegistrationParams): UseStacRegistrationResult {
  const [sliceLayerMap, setSliceLayerMap] = useState<SliceLayerMap>(new Map());
  const [allRegistered, setAllRegistered] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled || !imagery || !imagery.windows.length) return;
    cancelledRef.current = false;
    setAllRegistered(false);

    // Build all slice descriptors
    const slices: Array<{ key: string; startDate: string; endDate: string }> = [];

    for (const w of imagery.windows) {
      for (const s of computeTimeSlices(
        w.window_start_date,
        w.window_end_date,
        imagery.slicing_interval,
        imagery.slicing_unit,
      )) {
        slices.push({
          key: `${w.id}-${s.index}`,
          startDate: s.startDate,
          endDate: s.endDate,
        });
      }
    }

    // Check if everything is already cached
    const result: SliceLayerMap = new Map();
    let allCached = true;

    for (const s of slices) {
      const cached = registrationCache.get(
        cacheKey(imagery.registration_url, bbox, imagery.search_body, s.startDate, s.endDate),
      );
      if (cached) {
        result.set(s.key, cached);
      } else {
        allCached = false;
      }
    }

    if (allCached) {
      setSliceLayerMap(result);
      setAllRegistered(true);
      return;
    }

    // Fire all uncached registrations in parallel, collect results, set map once
    const uncached = slices.filter(
      (s) =>
        !registrationCache.has(
          cacheKey(imagery.registration_url, bbox, imagery.search_body, s.startDate, s.endDate),
        ),
    );

    const promises = uncached.map(async (s) => {
      if (cancelledRef.current) return;
      try {
        const searchId = await registerSlice(
          imagery.registration_url,
          imagery.search_body,
          bbox,
          s.startDate,
          s.endDate,
        );
        result.set(s.key, searchId);
      } catch (err) {
        if (!cancelledRef.current) {
          console.error(`[useStacRegistration] Failed slice ${s.key}:`, err);
        }
      }
    });

    Promise.all(promises).then(() => {
      if (cancelledRef.current) return;
      setSliceLayerMap(new Map(result));
      setAllRegistered(true);
    });

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, imagery?.id, bbox.join(',')]);

  return { sliceLayerMap, allRegistered };
}
