import { useEffect, useRef } from 'react';
import type { WorkMode } from '~/features/annotation/stores';
import {
  applyCameraTarget,
  fitAnnotations,
  focusCameraTarget,
  mainCamera,
} from '~/features/annotation/shared/cameras';
import { getMapFocus, useMapFocus } from '~/features/annotation/shared/mapFocus';

export { fitAnnotations };

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

/** Keeps the leader camera on the shared focus. Working zoom is read at move
 *  time so cycling imagery never yanks a camera the user just positioned. */
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
