import View from 'ol/View';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import { useEffect, useState } from 'react';
import type { Bbox, CameraSnapshot, CameraState, LonLat } from './types';

/** Working zoom when nothing else declares one. */
export const DEFAULT_MAP_ZOOM = 15;

const WGS84 = 'EPSG:4326';
const MERCATOR = 'EPSG:3857';

export class Camera {
  private readonly view: View;
  private readonly listeners = new Set<(s: CameraSnapshot) => void>();
  private frame: number | null = null;
  private attached = false;
  private pendingFit: {
    bbox: Bbox;
    paddingPx?: number;
    maxZoom?: number;
    minZoom?: number;
  } | null = null;

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

  /**
   * Frame a box.
   *
   * `minZoom` is the scale below which the data stops being worth looking at:
   * a box far larger than what it holds is framed at its centre rather than in
   * full, because fitting it would put the content a few pixels across.
   */
  fitBounds(
    bbox: Bbox,
    opts?: { paddingPx?: number; maxZoom?: number; minZoom?: number; animateMs?: number }
  ): void {
    if (!this.attached) {
      this.pendingFit = {
        bbox,
        paddingPx: opts?.paddingPx,
        maxZoom: opts?.maxZoom,
        minZoom: opts?.minZoom,
      };
      return;
    }
    const pad = opts?.paddingPx ?? 0;
    const previous = this.getState();

    // Landed immediately rather than animated, because the floor below has to
    // read the zoom the fit chose - during an animation the view still reports
    // the one it is leaving. Where a glide was asked for, the target computed
    // here is animated to instead, all before anything paints.
    this.view.fit(transformExtent(bbox, WGS84, MERCATOR), {
      padding: [pad, pad, pad, pad],
      maxZoom: opts?.maxZoom,
    });
    const minZoom = opts?.minZoom;
    if (minZoom !== undefined && (this.view.getZoom() ?? minZoom) < minZoom) {
      this.view.setZoom(minZoom);
    }

    if (opts?.animateMs) {
      const target = this.getState();
      this.moveTo(previous);
      this.moveTo(target, { animateMs: opts.animateMs });
    }
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

/** A camera's zoom, re-rendered as it moves. */
export function useCameraZoom(camera: Camera): number {
  const [zoom, setZoom] = useState(() => camera.getState().zoom);
  useEffect(() => camera.onChange((state) => setZoom(state.zoom)), [camera]);
  return zoom;
}

/** Live bounds of a camera, refreshed on its rAF-coalesced onChange. */
export function useCameraBounds(camera: Camera): Bbox {
  const [bounds, setBounds] = useState(() => camera.getBounds());
  useEffect(() => camera.onChange((s) => setBounds(s.bounds)), [camera]);
  return bounds;
}
