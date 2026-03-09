import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { stacRegistrationLimiter } from '~/shared/utils/concurrencyLimiter';
import { computeTimeSlices } from '~/shared/utils/utility';
import type { ImageryWithWindowsOut } from '~/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SliceDescriptor {
  /** Stable key: `{windowId}-{sliceIndex}` */
  key: string;
  windowId: number;
  /** 0-based index within the window */
  sliceIndex: number;
  /** true when this is slice 0 of its window */
  isFirstOfWindow: boolean;
  startDate: string;
  endDate: string;
}

/** One entry per viz template with its resolved tile URL */
export interface SliceTileUrl {
  templateId: number;
  templateName: string;
  url: string;
}

/** Map from sliceKey -> resolved tile URLs for every viz template */
export type SliceLayerMap = Map<string, SliceTileUrl[]>;

// ---------------------------------------------------------------------------
// Session-level cache - survives re-renders and component remounts.
// Key: `${registrationUrl}|${bbox}|${searchBodyHash}|${startDate}|${endDate}`
// Value: resolved tile URLs for every viz template for that date range.
// ---------------------------------------------------------------------------
const registrationCache = new Map<string, SliceTileUrl[]>();

function makeCacheKey(
  registrationUrl: string,
  bbox: [number, number, number, number],
  searchBody: Record<string, unknown>,
  startDate: string,
  endDate: string,
): string {
  return `${registrationUrl}|${bbox.join(',')}|${JSON.stringify(searchBody)}|${startDate}|${endDate}`;
}

// ---------------------------------------------------------------------------
// Core registration helper (used outside of React render cycle)
// ---------------------------------------------------------------------------

async function registerSlice(
  registrationUrl: string,
  searchBody: Record<string, unknown>,
  bbox: [number, number, number, number],
  startDate: string,
  endDate: string,
  visualizationUrlTemplates: Array<{ id: number; name: string; visualization_url: string }>,
): Promise<SliceTileUrl[]> {
  const cacheKey = makeCacheKey(registrationUrl, bbox, searchBody, startDate, endDate);

  if (registrationCache.has(cacheKey)) {
    return registrationCache.get(cacheKey)!;
  }

  const payload = {
    ...searchBody,
    bbox,
  };

  const payloadString = JSON.stringify(payload);
  const replaced = payloadString
    .replace(/\{startDatetimePlaceholder\}/g, startDate)
    .replace(/\{endDatetimePlaceholder\}/g, endDate);
  const finalPayload = JSON.parse(replaced);

  const response = await stacRegistrationLimiter.execute(() =>
    axios.post(registrationUrl, finalPayload),
  );

  const searchId =
    response.data?.searchId ?? response.data?.searchid ?? response.data?.search_id;

  if (!searchId) throw new Error('No searchId returned from registration endpoint');

  const urls: SliceTileUrl[] = visualizationUrlTemplates.map((t) => ({
    templateId: t.id,
    templateName: t.name,
    url: t.visualization_url.replace(/\{searchId\}/g, searchId),
  }));

  registrationCache.set(cacheKey, urls);
  return urls;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseStacAllSlicesParams {
  imagery: ImageryWithWindowsOut | null;
  bbox: [number, number, number, number];
  /** The currently active window id - drives registration priority */
  activeWindowId: number | null;
  enabled?: boolean;
}

interface UseStacAllSlicesResult {
  /** Resolved tile-URL map. Populated incrementally as registrations complete. */
  sliceLayerMap: SliceLayerMap;
  /** Total number of slices that need registration */
  totalSlices: number;
  /** How many have been registered so far */
  registeredSlices: number;
}

/**
 * Registers STAC mosaic search IDs for every slice of every window in the imagery,
 * in priority order:
 *   1. First slice (index 0) of every window   - warms the "default view" for all windows
 *   2. Remaining slices of the active window    - fills in the window the user is looking at
 *   3. Remaining slices of all other windows    - background warm-up
 *
 * Results are cached at module level so navigating away and back never re-registers.
 * The returned `sliceLayerMap` is updated incrementally (React state), so callers
 * see each slice become available as soon as it resolves.
 */
export function useStacAllSlices({
  imagery,
  bbox,
  activeWindowId,
  enabled = true,
}: UseStacAllSlicesParams): UseStacAllSlicesResult {
  const [sliceLayerMap, setSliceLayerMap] = useState<SliceLayerMap>(new Map());
  const [totalSlices, setTotalSlices] = useState(0);
  const [registeredSlices, setRegisteredSlices] = useState(0);

  // Ref to abort when imagery / bbox changes
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled || !imagery || !imagery.windows.length) return;

    cancelledRef.current = false;

    // -----------------------------------------------------------------------
    // Build the full list of slice descriptors
    // -----------------------------------------------------------------------
    const allDescriptors: SliceDescriptor[] = [];

    for (const window of imagery.windows) {
      const slices = computeTimeSlices(
        window.window_start_date,
        window.window_end_date,
        imagery.slicing_interval,
        imagery.slicing_unit,
      );
      for (const slice of slices) {
        allDescriptors.push({
          key: `${window.id}-${slice.index}`,
          windowId: window.id,
          sliceIndex: slice.index,
          isFirstOfWindow: slice.index === 0,
          startDate: slice.startDate,
          endDate: slice.endDate,
        });
      }
    }

    setTotalSlices(allDescriptors.length);

    // -----------------------------------------------------------------------
    // Sort into registration priority order:
    //   priority 0 - first slice of every window
    //   priority 1 - other slices of the active window
    //   priority 2 - everything else
    // -----------------------------------------------------------------------
    const effectiveActiveWindowId = activeWindowId ?? imagery.default_main_window_id ?? imagery.windows[0]?.id;

    const sorted = [...allDescriptors].sort((a, b) => {
      const pa = a.isFirstOfWindow ? 0 : a.windowId === effectiveActiveWindowId ? 1 : 2;
      const pb = b.isFirstOfWindow ? 0 : b.windowId === effectiveActiveWindowId ? 1 : 2;
      if (pa !== pb) return pa - pb;
      // Within same priority, preserve window order then slice order
      if (a.windowId !== b.windowId) return a.windowId - b.windowId;
      return a.sliceIndex - b.sliceIndex;
    });

    // Seed the map with anything already in the module-level cache
    const initialMap: SliceLayerMap = new Map();
    let alreadyDone = 0;
    for (const desc of sorted) {
      const cacheKey = makeCacheKey(
        imagery.registration_url,
        bbox,
        imagery.search_body,
        desc.startDate,
        desc.endDate,
      );
      const cached = registrationCache.get(cacheKey);
      if (cached) {
        initialMap.set(desc.key, cached);
        alreadyDone++;
      }
    }
    setSliceLayerMap(initialMap);
    setRegisteredSlices(alreadyDone);

    // If everything is already cached, nothing to do
    if (alreadyDone === allDescriptors.length) return;

    // -----------------------------------------------------------------------
    // Fire registrations in parallel, concurrency-limited by the limiter
    // -----------------------------------------------------------------------
    let done = alreadyDone;

    const pending = sorted
      .filter((desc) => {
        const cacheKey = makeCacheKey(
          imagery.registration_url,
          bbox,
          imagery.search_body,
          desc.startDate,
          desc.endDate,
        );
        return !registrationCache.has(cacheKey);
      })
      .map(async (desc) => {
        if (cancelledRef.current) return;

        try {
          const urls = await registerSlice(
            imagery.registration_url,
            imagery.search_body,
            bbox,
            desc.startDate,
            desc.endDate,
            imagery.visualization_url_templates,
          );

          if (cancelledRef.current) return;

          done++;
          const key = desc.key;
          setSliceLayerMap((prev) => {
            const next = new Map(prev);
            next.set(key, urls);
            return next;
          });
          setRegisteredSlices(done);
        } catch (err) {
          if (cancelledRef.current) return;
          console.error(`[useStacAllSlices] Failed to register slice ${desc.key}:`, err);
        }
      });

    Promise.all(pending);

    return () => {
      cancelledRef.current = true;
      stacRegistrationLimiter.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // bbox array identity is unstable - use join as stable dep
  }, [
    enabled,
    imagery?.id,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    bbox.join(','),
    activeWindowId,
  ]);

  return { sliceLayerMap, totalSlices, registeredSlices };
}
