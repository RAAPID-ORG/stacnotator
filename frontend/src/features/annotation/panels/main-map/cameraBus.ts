import { useEffect, useRef } from 'react';
import type { WorkMode } from '~/features/annotation/stores';
import {
  applyCameraTarget,
  fitAnnotations,
  fitBbox,
  focusCameraTarget,
  mainCamera,
} from '~/features/annotation/shared/cameras';
import {
  getMapFocus,
  setMapFocus,
  useMapFocus,
  type MapFocus,
} from '~/features/annotation/shared/mapFocus';

export { getMapFocus, setMapFocus, useMapFocus, type MapFocus };
// Explore's controls panel offers the same fit command, so it lives with the
// cameras; the map keeps reaching it here.
export { fitAnnotations, fitBbox };

const PAN_DISTANCE_PIXELS = 100;
const ZOOM_ANIMATION_MS = 200;

export type PanDirection = 'up' | 'down' | 'left' | 'right';

const PAN_VECTORS: Record<PanDirection, [number, number]> = {
  up: [0, -PAN_DISTANCE_PIXELS],
  down: [0, PAN_DISTANCE_PIXELS],
  left: [-PAN_DISTANCE_PIXELS, 0],
  right: [PAN_DISTANCE_PIXELS, 0],
};

/** A step is one pixel-space nudge, landing immediately rather than gliding:
 *  holding an arrow key repeats faster than a glide could finish anyway. */
export function pan(direction: PanDirection): void {
  const [dx, dy] = PAN_VECTORS[direction];
  mainCamera.panByPixels(dx, dy);
}

export function zoom(delta: 1 | -1): void {
  mainCamera.zoomBy(delta, { animateMs: ZOOM_ANIMATION_MS });
}

/** Space in tasks mode: back to the task, keeping the user's zoom. */
export function recenter(): void {
  const focus = getMapFocus();
  if (!focus) return;
  mainCamera.moveTo({ center: focus.center });
}

/**
 * Keeps the leader camera on whatever the map is pointed at. In tasks mode the
 * focus moves with the current task, and the map has to follow it - navigating
 * to a task the camera never visits is the whole feature. Nothing else drives
 * the camera from state, so this is the one subscription.
 *
 * The working zoom is read at move time rather than depended on: cycling the
 * imagery source changes it, and that must not yank the camera the user just
 * positioned.
 */
export function useFocusCamera(mode: WorkMode, workingZoom: number | null): void {
  const focus = useMapFocus();
  const center = focus?.center ?? null;
  const lon = center?.[0];
  const lat = center?.[1];
  const zoomRef = useRef(workingZoom);
  zoomRef.current = workingZoom;

  useEffect(() => {
    if (lon === undefined || lat === undefined) return;
    applyCameraTarget(
      focusCameraTarget({ mode, center: [lon, lat], workingZoom: zoomRef.current })
    );
  }, [mode, lon, lat]);
}
