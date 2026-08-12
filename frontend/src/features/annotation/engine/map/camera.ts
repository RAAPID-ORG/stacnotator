import View from 'ol/View';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import type { Bbox, CameraSnapshot, CameraState, LonLat } from './types';

const WGS84 = 'EPSG:4326';
const MERCATOR = 'EPSG:3857';

export class CameraController {
  private readonly view: View;
  private readonly listeners = new Set<(s: CameraSnapshot) => void>();
  private frame: number | null = null;

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

  getState(): CameraState {
    const center = toLonLat(this.view.getCenter() ?? [0, 0]) as LonLat;
    return { center, zoom: this.view.getZoom() ?? 0 };
  }

  /** Current viewport extent in EPSG:4326 - the same value `onChange`
   *  snapshots carry, available synchronously (e.g. for a caller's initial
   *  render, before any change event has fired). */
  getBounds(): Bbox {
    return transformExtent(this.view.calculateExtent(), MERCATOR, WGS84) as Bbox;
  }

  /**
   * The EPSG:4326 coordinate under a pixel position within a container that
   * is assumed centred on this camera - a minimap's own click/drag-to-pan
   * math, since MapView exposes no drag events to compute this from a real
   * pointer trail. Kept here rather than hand-rolled per caller so it always
   * matches this camera's actual resolution, not an assumed tile-pyramid
   * constant.
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
    const pad = opts?.paddingPx ?? 0;
    this.view.fit(transformExtent(bbox, WGS84, MERCATOR), {
      padding: [pad, pad, pad, pad],
      maxZoom: opts?.maxZoom,
      duration: opts?.animateMs,
    });
  }

  /**
   * Mirror another camera's position, snapping to it immediately. Applied without
   * animation: followers track per-frame motion, and an animation would fight the
   * next update.
   */
  follow(leader: CameraController): () => void {
    this.moveTo(leader.getState());
    return leader.onChange((state) => this.moveTo({ center: state.center, zoom: state.zoom }));
  }

  /** Coalesced to one callback per frame; a drag emits far more changes than that. */
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
    if (this.frame !== null || this.listeners.size === 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot);
    });
  }

  private snapshot(): CameraSnapshot {
    return { ...this.getState(), bounds: this.getBounds() };
  }
}

export function createCamera(initial: CameraState): CameraController {
  return new CameraController(initial);
}
