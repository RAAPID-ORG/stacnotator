import { useEffect, useMemo, useRef, useState } from 'react';
import { getAnnotationDensity, type AnnotationDensityCell } from '~/api/client';
import { IconExternalLink } from '~/shared/ui/Icons';
import { useContainerSize } from '~/features/annotation/engine/canvas';
import { mainCamera, minimapCamera } from '~/features/annotation/shared/cameras';
import {
  MapView,
  type Bbox,
  type CameraController,
  type FeatureLayerSpec,
  type LayerSpec,
  type LonLat,
  type RasterLayerSpec,
} from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../../composition';
import { exploreRefitTarget, tasksModeTarget } from './followTarget';
import { type GeocodingResult } from './geocoding';
import { LocationSearch } from './LocationSearch';
import {
  campaignBboxLayer,
  centerOfBounds,
  containsPoint,
  translateBounds,
  viewportRectLayer,
} from './ViewportRect';

const MINIMAP_BASEMAP: RasterLayerSpec = {
  kind: 'raster',
  id: 'minimap-basemap',
  url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  auth: 'none',
  attribution: 'OSM, CARTO',
  maxZoom: 19,
};

const REFIT_ANIMATE_MS = 300;

/** Drives the minimap camera off the main one per followTarget.ts's rules,
 *  rather than an exact `.follow()`. Runs the fit/re-centre once on mode
 *  change (so switching mode or mounting gets an immediate correct view)
 *  and again on every main-camera change after that. */
function useMinimapFollow(mode: ComposeCtx['mode']): void {
  useEffect(() => {
    const sync = () => {
      if (mode === 'tasks') {
        minimapCamera.moveTo(tasksModeTarget(mainCamera.getState().center));
        return;
      }
      const target = exploreRefitTarget(minimapCamera.getBounds(), mainCamera.getBounds());
      if (target) minimapCamera.fitBounds(target, { animateMs: REFIT_ANIMATE_MS });
    };
    sync();
    return mainCamera.onChange(sync);
  }, [mode]);
}

/** Live bounds of a camera, refreshed on its rAF-coalesced onChange. */
function useCameraBounds(camera: CameraController) {
  const [bounds, setBounds] = useState(() => camera.getBounds());
  useEffect(() => camera.onChange((s) => setBounds(s.bounds)), [camera]);
  return bounds;
}

function useCameraCenter(camera: CameraController): LonLat {
  const [center, setCenter] = useState<LonLat>(() => camera.getState().center);
  useEffect(() => camera.onChange((s) => setCenter(s.center)), [camera]);
  return center;
}

function useCameraZoom(camera: CameraController): number {
  const [zoom, setZoom] = useState(() => camera.getState().zoom);
  useEffect(() => camera.onChange((state) => setZoom(state.zoom)), [camera]);
  return zoom;
}

function densityLayer(cells: AnnotationDensityCell[]): FeatureLayerSpec | null {
  if (cells.length === 0) return null;
  const maxLog = Math.max(...cells.map((c) => Math.log1p(c.count)));
  return {
    kind: 'features',
    id: 'minimap-density',
    features: cells.map((c, i) => ({
      id: i,
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { count: c.count },
    })),
    style: (f) => {
      const t = maxLog > 0 ? Math.log1p(Number(f.properties?.count ?? 0)) / maxLog : 0;
      return {
        circle: { radius: 2 + t * 6, fill: { color: `rgba(220,80,60,${0.25 + t * 0.5})` } },
      };
    },
    zIndex: 4,
  };
}

export function MinimapHeader({ ctx: _ctx }: { ctx: ComposeCtx }) {
  const [expanded, setExpanded] = useState(false);
  const center = useCameraCenter(mainCamera);

  const copyCoordinates = () => {
    void navigator.clipboard?.writeText(`${center[1].toFixed(5)},${center[0].toFixed(5)}`);
  };

  const onSelect = (result: GeocodingResult) => {
    mainCamera.moveTo({ center: result.center });
    if (result.extent) mainCamera.fitBounds(result.extent, { paddingPx: 40, animateMs: 300 });
  };

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      {!expanded && (
        <span
          data-testid="viewport-center"
          className="truncate text-xs font-medium tabular-nums text-neutral-700"
        >
          {center[1].toFixed(5)}, {center[0].toFixed(5)}
        </span>
      )}
      <div
        className={`flex min-w-0 items-center gap-0.5 ${expanded ? 'flex-1' : 'ml-auto shrink-0'}`}
      >
        {!expanded && (
          <>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={copyCoordinates}
              title="Copy coordinates to clipboard"
              className="p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 rounded transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
              </svg>
            </button>
            <a
              href={`https://earth.google.com/web/search/${center[1]},${center[0]}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Google Earth"
              data-tour="open-in-google-earth"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 rounded transition-colors"
            >
              <IconExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
        <LocationSearch
          expanded={expanded}
          onExpandedChange={setExpanded}
          onSelect={onSelect}
          className={expanded ? 'w-full' : ''}
        />
      </div>
    </div>
  );
}

export function MinimapBody({ ctx }: { ctx: ComposeCtx }) {
  const { containerRef, width, height } = useContainerSize();
  const dragFrame = useRef<number | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const [previewBounds, setPreviewBounds] = useState<Bbox | null>(null);

  useMinimapFollow(ctx.mode);
  useEffect(() => () => dragCleanup.current?.(), []);

  const bounds = useCameraBounds(mainCamera);
  const minimapZoom = useCameraZoom(minimapCamera);
  const displayedBounds = previewBounds ?? bounds;

  const viewportCenterPixel =
    width > 0 && height > 0
      ? minimapCamera.containerPixelFromLonLat(centerOfBounds(displayedBounds), width, height)
      : null;

  const [density, setDensity] = useState<AnnotationDensityCell[]>([]);
  useEffect(() => {
    if (ctx.mode !== 'explore') {
      setDensity([]);
      return;
    }
    let cancelled = false;
    void getAnnotationDensity({ path: { campaign_id: ctx.catalog.campaignId } })
      .then((res) => {
        if (!cancelled) setDensity(res.data ?? []);
      })
      .catch(() => {
        // best-effort overview; a failed fetch just leaves the map plain
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.mode, ctx.catalog.campaignId, ctx.campaign.annotations_version]);

  const layers = useMemo<LayerSpec[]>(() => {
    const list: LayerSpec[] = [
      MINIMAP_BASEMAP,
      campaignBboxLayer(ctx.catalog.bbox),
      viewportRectLayer(displayedBounds),
    ];
    const density_ = densityLayer(density);
    if (density_) list.push(density_);
    return list;
  }, [ctx.catalog.bbox, displayedBounds, density]);

  const pointAt = (clientX: number, clientY: number): LonLat | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return minimapCamera.lonLatFromContainerPixel(
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      rect.height
    );
  };

  // Only the viewport polygon navigates the main map. Background drags and
  // wheel events remain OpenLayers interactions for panning/zooming the
  // minimap itself; controls (especially attribution) are left untouched.
  // During a viewport drag only the cheap vector preview moves. The main
  // camera receives one final destination on pointerup, so its imagery never
  // loads a trail of intermediate locations.
  const handlePointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest?.('.ol-control')) return;
    const startPoint = pointAt(e.clientX, e.clientY);
    if (!startPoint || !containsPoint(bounds, startPoint)) return;

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
        mainCamera.moveTo({ center: finalCenter });
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
      className={`relative h-full w-full ${previewBounds ? 'cursor-grabbing' : ''}`}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <MapView camera={minimapCamera} layers={layers} wheelZoom="plain" />
    </div>
  );
}
