import View from 'ol/View';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import { getAnnotationsExtent } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import type { Bbox, CameraSnapshot, CameraState, LonLat } from './types';

const WGS84 = 'EPSG:4326';
const MERCATOR = 'EPSG:3857';

export class Camera {
  private readonly view: View;
  private readonly listeners = new Set<(s: CameraSnapshot) => void>();
  private frame: number | null = null;
  private attached = false;
  private pendingFit: { bbox: Bbox; paddingPx?: number; maxZoom?: number } | null = null;

  constructor(initial: CameraState) {
    this.view = new View({
      center: fromLonLat(initial.center),
      zoom: initial.zoom,
      constrainResolution: false,
    });
    const schedule = () => this.scheduleEmit();
    this.view.on('change:center', schedule);
    this.view.on('change:resolution', schedule);
  }

  /** The OL view to mount a map on. MapView is the only intended caller. */
  getView(): View {
    return this.view;
  }

  /**
   * Announce that a map with a real viewport now renders this camera. Until
   * then the view still carries OpenLayers' placeholder size and a fit
   * computed against it lands nowhere, so `fitBounds` holds its request and
   * this replays it - without animation, since there was nothing on screen to
   * animate from. Idempotent.
   */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const pending = this.pendingFit;
    this.pendingFit = null;
    if (pending) this.fitBounds(pending.bbox, pending);
  }

  getState(): CameraState {
    return {
      center: toLonLat(this.view.getCenter() ?? [0, 0]) as LonLat,
      zoom: this.view.getZoom() ?? 0,
    };
  }

  /** Current extent in EPSG:4326, available synchronously - the same value
   *  `onChange` snapshots carry. */
  getBounds(): Bbox {
    return transformExtent(this.view.calculateExtent(), MERCATOR, WGS84) as Bbox;
  }

  /**
   * The coordinate under a pixel position within a container assumed centred
   * on this camera - a minimap's click and drag-to-pan maths, since MapView
   * exposes no drag events. Kept here so it always matches this camera's real
   * resolution rather than an assumed tile-pyramid constant.
   */
  lonLatFromContainerPixel(
    offsetX: number,
    offsetY: number,
    containerWidthPx: number,
    containerHeightPx: number
  ): LonLat {
    const resolution = this.view.getResolution() ?? 0;
    const [cx, cy] = this.view.getCenter() ?? [0, 0];
    const dx = offsetX - containerWidthPx / 2;
    const dy = offsetY - containerHeightPx / 2;
    return toLonLat([cx + dx * resolution, cy - dy * resolution]) as LonLat;
  }

  /** The inverse, for overlays that must line up with geometry this camera
   *  renders - the minimap's draggable viewport rectangle. */
  containerPixelFromLonLat(
    coordinate: LonLat,
    containerWidthPx: number,
    containerHeightPx: number
  ): [number, number] {
    const resolution = this.view.getResolution() ?? 0;
    const [cx, cy] = this.view.getCenter() ?? [0, 0];
    const [x, y] = fromLonLat(coordinate);
    if (resolution === 0) return [containerWidthPx / 2, containerHeightPx / 2];
    return [
      containerWidthPx / 2 + (x - cx) / resolution,
      containerHeightPx / 2 + (cy - y) / resolution,
    ];
  }

  moveTo(target: Partial<CameraState>, opts?: { animateMs?: number }): void {
    const center = target.center ? fromLonLat(target.center) : undefined;
    if (opts?.animateMs) {
      this.view.animate({ center, zoom: target.zoom, duration: opts.animateMs });
      return;
    }
    if (center) this.view.setCenter(center);
    if (target.zoom !== undefined) this.view.setZoom(target.zoom);
  }

  /** Screen pixels: +dx moves the view east, +dy moves it south. */
  panByPixels(dx: number, dy: number): void {
    const resolution = this.view.getResolution() ?? 0;
    const [x, y] = this.view.getCenter() ?? [0, 0];
    this.view.setCenter([x + dx * resolution, y - dy * resolution]);
  }

  zoomBy(delta: number, opts?: { animateMs?: number }): void {
    this.moveTo({ zoom: (this.view.getZoom() ?? 0) + delta }, opts);
  }

  fitBounds(bbox: Bbox, opts?: { paddingPx?: number; maxZoom?: number; animateMs?: number }): void {
    if (!this.attached) {
      this.pendingFit = { bbox, paddingPx: opts?.paddingPx, maxZoom: opts?.maxZoom };
      return;
    }
    const pad = opts?.paddingPx ?? 0;
    this.view.fit(transformExtent(bbox, WGS84, MERCATOR), {
      padding: [pad, pad, pad, pad],
      maxZoom: opts?.maxZoom,
      duration: opts?.animateMs,
    });
  }

  /** Mirror another camera, snapping rather than animating: followers track
   *  per-frame motion and an animation would fight the next update. */
  follow(leader: Camera): () => void {
    this.moveTo(leader.getState());
    return leader.onChange((state) => this.moveTo({ center: state.center, zoom: state.zoom }));
  }

  /** Coalesced to one callback per frame; a drag emits far more than that. */
  onChange(cb: (s: CameraSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0 && this.frame !== null) {
        cancelAnimationFrame(this.frame);
        this.frame = null;
      }
    };
  }

  private scheduleEmit(): void {
    if (this.frame !== null) return;
    // Scheduled even with nobody listening yet: a move made while a panel is
    // still mounting must still reach it, or that panel renders the position
    // the camera has already left.
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.listeners.size === 0) return;
      const snapshot = { ...this.getState(), bounds: this.getBounds() };
      for (const listener of this.listeners) listener(snapshot);
    });
  }
}

// ---------------------------------------------------------------------------
// The page's cameras. Module-scope because they outlive any one campaign and
// the whole point is that every map can follow the same leader.
// ---------------------------------------------------------------------------

/** Whole world until the page fits the camera to the campaign. */
const INITIAL: CameraState = { center: [0, 0], zoom: 2 };

/** Working zoom when no imagery source declares one. */
export const DEFAULT_MAP_ZOOM = 15;

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
