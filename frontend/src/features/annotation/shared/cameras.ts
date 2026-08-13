import { getAnnotationsExtent } from '~/api/client';
import type { WorkMode } from '~/features/annotation/stores';
import {
  createCamera,
  type Bbox,
  type CameraController,
  type LonLat,
} from '~/features/annotation/engine/map';
import { handleError } from '~/shared/utils/errorHandler';

/** Whole-world view until the page fits the camera to the campaign bbox. */
const INITIAL_CAMERA = { center: [0, 0] as [number, number], zoom: 2 };

/** Working zoom when no imagery source declares one. */
export const DEFAULT_MAP_ZOOM = 15;

export const mainCamera: CameraController = createCamera(INITIAL_CAMERA);

export const minimapCamera: CameraController = createCamera(INITIAL_CAMERA);

const windowCameras = new Map<number, CameraController>();
const pendingRelease = new Map<number, ReturnType<typeof setTimeout>>();

/** The camera of one collection's imagery window, created on first use. */
export function cameraFor(collectionId: number): CameraController {
  const pending = pendingRelease.get(collectionId);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingRelease.delete(collectionId);
  }
  const existing = windowCameras.get(collectionId);
  if (existing) return existing;
  const camera = createCamera(mainCamera.getState());
  windowCameras.set(collectionId, camera);
  return camera;
}

/**
 * Drops a window camera once its collection leaves the view. Follow
 * subscriptions are unhooked by their own unfollow callbacks; this only stops
 * the map growing a camera per collection ever browsed.
 *
 * Deferred by a tick because "leaves the view" and "moves to another window"
 * look identical from here: sending a panel to a second screen (or returning
 * it) unmounts it and remounts it around the same camera, and React runs the
 * unmount cleanup first. Dropping the camera in between would snap that window
 * back to wherever the main map is. Whoever remounts reclaims it through
 * `cameraFor`, which cancels the release.
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

export function fitBbox(bbox: Bbox): void {
  mainCamera.fitBounds(bbox, {
    paddingPx: FIT_PADDING_PX,
    maxZoom: FIT_MAX_ZOOM,
    animateMs: 400,
  });
}

/** Frame every annotation in the campaign: the server knows their extent, and
 *  a campaign with none leaves the camera alone. Lives with the cameras rather
 *  than in main-map's camera commands because Explore's controls panel offers the
 *  another. */
export async function fitAnnotations(campaignId: number): Promise<boolean> {
  try {
    const result = await getAnnotationsExtent({ path: { campaign_id: campaignId } });
    const bbox = result.data?.bbox;
    if (!bbox) return false;
    fitBbox(bbox);
    return true;
  } catch (error) {
    // Pressing Space and having nothing happen is confusing enough without
    // the reason being invisible too.
    handleError(error, 'Could not load the annotation extent');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Where the camera belongs
// ---------------------------------------------------------------------------

/** A camera move, decided without touching a camera so the decision is
 *  testable on its own. */
export type CameraTarget =
  | { kind: 'fit'; bbox: Bbox }
  | { kind: 'center'; center: LonLat; zoom: number };

export interface LoadCameraInput {
  mode: WorkMode;
  /** The first task's centre, in tasks mode. */
  taskCenter: LonLat | null;
  /** The campaign's own extent, from its settings. */
  campaignBbox: Bbox | null;
  /** The active imagery source's configured working zoom. */
  workingZoom: number | null;
  /** ?lat/?lon from the annotations page's "View" link. */
  deepLinkCenter?: LonLat | null;
}

/**
 * Where the camera goes once a campaign has finished loading. Without this the
 * page opens on the whole world whatever it just loaded.
 *
 * A deep link is the most specific instruction there is, so it wins - and only
 * in Explore, which is the only mode that link is offered from. Tasks work is
 * task-centered; Explore opens at the campaign center and working zoom.
 */
export function loadCameraTarget(input: LoadCameraInput): CameraTarget | null {
  const zoom = input.workingZoom ?? DEFAULT_MAP_ZOOM;
  if (input.mode === 'explore' && input.deepLinkCenter) {
    return { kind: 'center', center: input.deepLinkCenter, zoom };
  }
  if (input.mode === 'tasks') {
    return input.taskCenter ? { kind: 'center', center: input.taskCenter, zoom } : null;
  }
  if (!input.campaignBbox) return null;
  const [west, south, east, north] = input.campaignBbox;
  return {
    kind: 'center',
    center: [(west + east) / 2, (south + north) / 2],
    zoom,
  };
}

/**
 * Where the camera goes when the map focus moves - i.e. when task navigation
 * makes another task current. Explore's focus never moves, so nothing there
 * drives the camera and the user's own view is left alone.
 */
export function focusCameraTarget(input: {
  mode: WorkMode;
  center: LonLat | null;
  workingZoom: number | null;
}): CameraTarget | null {
  if (input.mode !== 'tasks' || !input.center) return null;
  return { kind: 'center', center: input.center, zoom: input.workingZoom ?? DEFAULT_MAP_ZOOM };
}

/** Carries out a decided move on the leader camera. */
export function applyCameraTarget(target: CameraTarget | null): void {
  if (!target) return;
  if (target.kind === 'fit') fitBbox(target.bbox);
  else mainCamera.moveTo({ center: target.center, zoom: target.zoom });
}

/** Move the first-view authoring canvas to its useful default scale without
 *  discarding the campaign centre chosen during the initial load. */
export function focusFirstViewSetup(workingZoom: number | null): void {
  mainCamera.moveTo({
    center: mainCamera.getState().center,
    zoom: workingZoom ?? DEFAULT_MAP_ZOOM,
  });
}
