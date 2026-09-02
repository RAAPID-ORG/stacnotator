import { useEffect, useMemo, useRef, useState } from 'react';
import { useContainerSize } from '~/shared/hooks/useContainerSize';
import { type Camera, useCameraBounds, useCameraZoom } from '../Camera';
import { MapView } from '../MapView';
import { BASEMAP_STYLE_URL } from '~/shared/imagery/tileUrls';
import type { Bbox, GlStyleLayerSpec, LayerSpec, LonLat } from '../types';
import {
  centerOfBounds,
  containsPoint,
  pinLayer,
  roiOutlineLayer,
  translateBounds,
  rectIsLegible,
  viewportRectLayer,
} from './viewportRect';

const MINIMAP_BASEMAP: GlStyleLayerSpec = {
  kind: 'gl-style',
  id: 'minimap-basemap',
  styleUrl: BASEMAP_STYLE_URL,
};

/** How far a press may travel and still count as a click rather than a pan. */
const CLICK_SLOP_PX = 4;

/**
 * An overview map: where the main map is looking, drawn as a rectangle you can
 * drag, over an area outline and whatever else the caller wants shown.
 *
 * It only draws and takes input. How the overview camera itself moves is the
 * caller's rule, see `useOverviewFollow` in ./follow.
 */
export function Minimap({
  camera,
  main,
  roi,
  layers = [],
  jumpOnClick = true,
  pin = null,
}: {
  camera: Camera;
  /** The camera this reflects, and lands somewhere new on click or drag. */
  main: Camera;
  roi?: Bbox | null;
  layers?: LayerSpec[];
  /** Whether a click on the background moves the main map there. Off where the
   *  main map's position is not the user's to choose - a task pins it. */
  jumpOnClick?: boolean;
  /** A fixed place to mark instead of the main map's viewport. Given one, this
   *  stops standing for where the main map looks: no rectangle to drag, and the
   *  overview camera is the viewer's alone to pan and zoom. */
  pin?: LonLat | null;
}) {
  const { containerRef, width, height } = useContainerSize();
  const dragFrame = useRef<number | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const [previewBounds, setPreviewBounds] = useState<Bbox | null>(null);

  useEffect(() => () => dragCleanup.current?.(), []);

  const bounds = useCameraBounds(main);
  const minimapZoom = useCameraZoom(camera);
  const displayedBounds = previewBounds ?? bounds;
  const mainCenter = centerOfBounds(bounds);

  const viewportCenterPixel =
    width > 0 && height > 0
      ? camera.containerPixelFromLonLat(centerOfBounds(displayedBounds), width, height)
      : null;

  // How big the viewport actually lands on this minimap, which is the only
  // thing that decides whether its box can be seen.
  const rectLegible = useMemo(() => {
    if (width <= 0 || height <= 0) return true;
    const [west, south, east, north] = displayedBounds;
    const [x0, y0] = camera.containerPixelFromLonLat([west, south], width, height);
    const [x1, y1] = camera.containerPixelFromLonLat([east, north], width, height);
    return rectIsLegible([Math.abs(x1 - x0), Math.abs(y1 - y0)]);
    // The camera projects through live OL state, so minimapZoom is what says
    // the projection moved under an unchanged bbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, minimapZoom, displayedBounds, width, height]);

  const allLayers = useMemo<LayerSpec[]>(
    () => [
      MINIMAP_BASEMAP,
      ...(roi ? [roiOutlineLayer(roi)] : []),
      pin ? pinLayer(pin) : viewportRectLayer(displayedBounds, { asMarker: !rectLegible }),
      ...layers,
    ],
    [roi, pin, displayedBounds, rectLegible, layers]
  );

  const pointAt = (clientX: number, clientY: number): LonLat | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return camera.lonLatFromContainerPixel(
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      rect.height
    );
  };

  // A background press stays an OpenLayers interaction (drag pans the minimap,
  // wheel zooms it), and only lands the main map somewhere new when it ends
  // without a real drag - the same destination a viewport drop would give.
  const watchBackgroundClick = (e: React.PointerEvent, target: LonLat) => {
    const start = { x: e.clientX, y: e.clientY };
    const cleanup = () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cleanup);
      dragCleanup.current = null;
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= CLICK_SLOP_PX) {
        main.moveTo({ center: target });
      }
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cleanup);
    dragCleanup.current = cleanup;
  };

  // Controls (especially attribution) are left untouched. During a viewport
  // drag only the cheap vector preview moves. The main camera receives one
  // final destination on pointerup, so its imagery never loads a trail of
  // intermediate locations.
  const handlePointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest?.('.ol-control')) return;
    const startPoint = pointAt(e.clientX, e.clientY);
    if (!startPoint) return;
    if (!containsPoint(bounds, startPoint)) {
      if (jumpOnClick) watchBackgroundClick(e, startPoint);
      return;
    }

    e.stopPropagation();
    e.preventDefault();
    const startBounds = bounds;
    setPreviewBounds(startBounds);

    const boundsAt = (clientX: number, clientY: number): Bbox => {
      const point = pointAt(clientX, clientY) ?? startPoint;
      return translateBounds(startBounds, [point[0] - startPoint[0], point[1] - startPoint[1]]);
    };

    const onMove = (ev: PointerEvent) => {
      if (dragFrame.current != null) return;
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = null;
        setPreviewBounds(boundsAt(ev.clientX, ev.clientY));
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (dragFrame.current != null) {
        cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
      }
      const finalBounds = boundsAt(ev.clientX, ev.clientY);
      const startCenter = centerOfBounds(startBounds);
      const finalCenter = centerOfBounds(finalBounds);
      setPreviewBounds(null);
      cleanup();
      if (finalCenter[0] !== startCenter[0] || finalCenter[1] !== startCenter[1]) {
        main.moveTo({ center: finalCenter });
      }
    };
    const onCancel = () => {
      if (dragFrame.current != null) {
        cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
      }
      setPreviewBounds(null);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragCleanup.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    dragCleanup.current = cleanup;
  };

  return (
    <div
      ref={containerRef}
      data-minimap-zoom={minimapZoom}
      data-viewport-center-x={viewportCenterPixel?.[0]}
      data-viewport-center-y={viewportCenterPixel?.[1]}
      // Where the main map is looking, from the component that already tracks it for
      // the rectangle. The one handle on that camera the DOM offers.
      data-main-lon={mainCenter[0].toFixed(5)}
      data-main-lat={mainCenter[1].toFixed(5)}
      className={`relative h-full w-full ${previewBounds ? 'cursor-grabbing' : ''}`}
      onPointerDownCapture={pin ? undefined : handlePointerDownCapture}
    >
      <MapView camera={camera} layers={allLayers} wheelZoom="plain" />
    </div>
  );
}
