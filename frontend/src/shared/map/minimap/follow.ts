import { useEffect } from 'react';
import type { Camera } from '../Camera';
import type { Bbox, LonLat } from '../types';

/** Fixed task-mode zoom: always centred on the task, at a stable scale. */
export const TASK_OVERVIEW_ZOOM = 8;

/** Each side of the padded box extends by this multiple of the viewport's
 *  own span, so the padded box is `1 + 2*factor` times the viewport's
 *  width/height. */
export const MINIMAP_PADDING_FACTOR = 1.5;

/** Below this fraction of the minimap's own area, the viewport reads as "too
 *  small to be a useful overview" even though it's still contained. */
export const MIN_VIEWPORT_AREA_RATIO = 0.02;

export function tasksModeTarget(mainCenter: LonLat): { center: LonLat; zoom: number } {
  return { center: mainCenter, zoom: TASK_OVERVIEW_ZOOM };
}

export function paddedBounds(bounds: Bbox, factor: number = MINIMAP_PADDING_FACTOR): Bbox {
  const [west, south, east, north] = bounds;
  const lonSpan = east - west;
  const latSpan = north - south;
  return [
    west - lonSpan * factor,
    south - latSpan * factor,
    east + lonSpan * factor,
    north + latSpan * factor,
  ];
}

function contains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
  );
}

function area([west, south, east, north]: Bbox): number {
  return Math.max(0, east - west) * Math.max(0, north - south);
}

/** True when the minimap needs a fresh fit to keep showing the main
 *  viewport comfortably: it isn't fully contained, or it has shrunk to a
 *  sliver of the minimap's own area (an earlier padded fit, now stale after
 *  the user zoomed the main map in a lot). */
export function needsRefit(
  minimapBounds: Bbox,
  viewportBounds: Bbox,
  minAreaRatio: number = MIN_VIEWPORT_AREA_RATIO
): boolean {
  if (!contains(minimapBounds, viewportBounds)) return true;
  const minimapArea = area(minimapBounds);
  if (minimapArea <= 0) return true;
  return area(viewportBounds) / minimapArea < minAreaRatio;
}

/** The continuous refit decision: the padded box to fit when the current
 *  minimap bounds no longer show the viewport well, else null (no change - the
 *  caller skips the fit entirely).
 *
 *  While the minimap still shows the ROI it holds that view until the viewport
 *  leaves it - seeing the whole area is the point, however small the viewport
 *  looks inside it. */
export function refitTarget(
  minimapBounds: Bbox,
  viewportBounds: Bbox,
  roiOverview: boolean
): Bbox | null {
  const stale = roiOverview
    ? !contains(minimapBounds, viewportBounds)
    : needsRefit(minimapBounds, viewportBounds);
  return stale ? paddedBounds(viewportBounds) : null;
}

const REFIT_ANIMATE_MS = 300;

/** Keeps the ROI outline off the minimap's edges when it opens on it. */
const ROI_FIT_PADDING_PX = 12;

/**
 * Opens the overview on `roi` and holds that view until the main camera walks
 * out of it, then keeps a padded box around the viewport from there on.
 *
 * Turn it off with `enabled` where another rule takes over (task mode pins the
 * overview to a fixed zoom instead).
 */
export function useOverviewFollow(
  minimap: Camera,
  main: Camera,
  roi: Bbox | null,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;
    let showingRoi = roi !== null;
    minimap.fitBounds(roi ?? paddedBounds(main.getBounds()), {
      paddingPx: roi ? ROI_FIT_PADDING_PX : 0,
    });
    return main.onChange(() => {
      const target = refitTarget(minimap.getBounds(), main.getBounds(), showingRoi);
      if (!target) return;
      showingRoi = false;
      minimap.fitBounds(target, { animateMs: REFIT_ANIMATE_MS });
    });
  }, [minimap, main, roi, enabled]);
}
