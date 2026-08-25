import { getAnnotationsExtent } from '~/api/client';
import { Camera, DEFAULT_MAP_ZOOM } from '~/shared/map/Camera';
import type { Bbox, CameraState, LonLat } from '~/shared/map/types';
import { handleError } from '~/shared/utils/errorHandler';

// ---------------------------------------------------------------------------
// The page's cameras. Module-scope because they outlive any one campaign and
// the whole point is that every map can follow the same leader.
// ---------------------------------------------------------------------------

/** Whole world until the page fits the camera to the campaign. */
const INITIAL: CameraState = { center: [0, 0], zoom: 2 };

export const mainCamera = new Camera(INITIAL);
export const minimapCamera = new Camera(INITIAL);

const windowCameras = new Map<number, Camera>();
const pendingRelease = new Map<number, ReturnType<typeof setTimeout>>();

/** One collection window's camera, created on first use. */
export function cameraFor(collectionId: number): Camera {
  const pending = pendingRelease.get(collectionId);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingRelease.delete(collectionId);
  }
  const existing = windowCameras.get(collectionId);
  if (existing) return existing;
  const camera = new Camera(mainCamera.getState());
  windowCameras.set(collectionId, camera);
  return camera;
}

/**
 * Drop a window camera once its collection leaves the view, so the page does
 * not grow one per collection ever browsed. Deferred by a tick because
 * "leaves the view" and "moves to another screen" look identical from here:
 * sending a panel to a second screen unmounts and remounts it around the same
 * camera, and React runs the unmount cleanup first. Whoever remounts reclaims
 * it through `cameraFor`, which cancels the release.
 */
export function releaseCamera(collectionId: number): void {
  if (pendingRelease.has(collectionId)) return;
  pendingRelease.set(
    collectionId,
    setTimeout(() => {
      pendingRelease.delete(collectionId);
      windowCameras.delete(collectionId);
    }, 0)
  );
}

const FIT_PADDING_PX = 60;
const FIT_MAX_ZOOM = 18;
const PAN_DISTANCE_PX = 100;
const ZOOM_ANIMATION_MS = 200;

export function fitBbox(bbox: Bbox): void {
  mainCamera.fitBounds(bbox, { paddingPx: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM, animateMs: 400 });
}

/** Frame every annotation in the campaign. The server knows their extent, and
 *  a campaign with none leaves the camera alone. The extent covers the same set
 *  the map draws, so Fit never flies off to something hidden. */
export async function fitAnnotations(campaignId: number, includeTasks: boolean): Promise<boolean> {
  try {
    const result = await getAnnotationsExtent({
      path: { campaign_id: campaignId },
      query: { include_tasks: includeTasks },
    });
    const bbox = result.data?.bbox;
    if (!bbox) return false;
    fitBbox(bbox);
    return true;
  } catch (error) {
    // Pressing Space and having nothing happen is confusing enough without the
    // reason being invisible too.
    handleError(error, 'Could not load the annotation extent');
    return false;
  }
}

export type PanDirection = 'up' | 'down' | 'left' | 'right';

const PAN_VECTORS: Record<PanDirection, [number, number]> = {
  up: [0, -PAN_DISTANCE_PX],
  down: [0, PAN_DISTANCE_PX],
  left: [-PAN_DISTANCE_PX, 0],
  right: [PAN_DISTANCE_PX, 0],
};

/** A nudge lands immediately rather than gliding: holding an arrow repeats
 *  faster than a glide could finish. */
export function pan(direction: PanDirection): void {
  const [dx, dy] = PAN_VECTORS[direction];
  mainCamera.panByPixels(dx, dy);
}

export function zoom(delta: 1 | -1): void {
  mainCamera.zoomBy(delta, { animateMs: ZOOM_ANIMATION_MS });
}

// ---------------------------------------------------------------------------
// Where the camera belongs. Decided without touching a camera so the decision
// is testable on its own.
// ---------------------------------------------------------------------------

export interface CameraTarget {
  center: LonLat;
  zoom: number;
}

/**
 * Where the camera goes once a campaign has loaded. Without this the page
 * opens on the whole world whatever it just loaded.
 *
 * A deep link is the most specific instruction there is, so it wins - and only
 * in Explore, the one mode that link is offered from. Tasks work is
 * task-centred; Explore opens at the campaign centre and working zoom.
 */
export function loadCameraTarget(input: {
  mode: 'tasks' | 'explore';
  taskCenter: LonLat | null;
  campaignBbox: Bbox | null;
  workingZoom: number | null;
  deepLinkCenter?: LonLat | null;
}): CameraTarget | null {
  const zoom = input.workingZoom ?? DEFAULT_MAP_ZOOM;
  if (input.mode === 'explore' && input.deepLinkCenter) {
    return { center: input.deepLinkCenter, zoom };
  }
  if (input.mode === 'tasks') return input.taskCenter ? { center: input.taskCenter, zoom } : null;
  if (!input.campaignBbox) return null;
  const [west, south, east, north] = input.campaignBbox;
  return { center: [(west + east) / 2, (south + north) / 2], zoom };
}

/** Where the camera goes when the focus moves - task navigation making
 *  another task current. Explore's focus never moves, so nothing there drives
 *  the camera and the user's own view is left alone. */
export function focusCameraTarget(input: {
  mode: 'tasks' | 'explore';
  center: LonLat | null;
  workingZoom: number | null;
}): CameraTarget | null {
  if (input.mode !== 'tasks' || !input.center) return null;
  return { center: input.center, zoom: input.workingZoom ?? DEFAULT_MAP_ZOOM };
}

export function applyCameraTarget(target: CameraTarget | null): void {
  if (target) mainCamera.moveTo(target);
}

/** Move the first-view authoring canvas to a useful scale without discarding
 *  the campaign centre chosen during the load. */
export function focusFirstViewSetup(workingZoom: number | null): void {
  mainCamera.moveTo({
    center: mainCamera.getState().center,
    zoom: workingZoom ?? DEFAULT_MAP_ZOOM,
  });
}
