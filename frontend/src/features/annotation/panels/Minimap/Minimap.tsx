import { useCampaign, useCampaignStore, useCatalog, type WorkMode } from '../../stores/campaign';
import { useImageryStore } from '../../stores/imagery';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAnnotationDensity, type AnnotationDensityCell } from '~/api/client';
import { IconExternalLink } from '~/shared/ui/Icons';
import { useContainerSize } from '../../canvas/useContainerSize';
import { mainCamera, minimapCamera } from '../../map/camera';
import { MapView } from '../../map/MapView';
import { type Camera } from '../../map/camera';
import {
  type Bbox,
  type FeatureLayerSpec,
  type LayerSpec,
  type LonLat,
  type RasterLayerSpec,
} from '../../map/types';
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

/** Keeps the ROI outline off the minimap's edges when Explore opens on it. */
const ROI_FIT_PADDING_PX = 12;

/** How far a press may travel and still count as a click rather than a pan. */
const CLICK_SLOP_PX = 4;

/** Drives the minimap camera off the main one per followTarget.ts's rules,
 *  rather than an exact `.follow()`. Explore opens on the campaign ROI, Tasks
 *  re-centres immediately (so switching mode or mounting gets an immediate
 *  correct view); both then track every main-camera change after that. */
function useMinimapFollow(mode: WorkMode, roi: Bbox): void {
  useEffect(() => {
    let roiOverview = false;
    const sync = () => {
      if (mode === 'tasks') {
        minimapCamera.moveTo(tasksModeTarget(mainCamera.getState().center));
        return;
      }
      const target = exploreRefitTarget(
        minimapCamera.getBounds(),
        mainCamera.getBounds(),
        roiOverview
      );
      if (!target) return;
      roiOverview = false;
      minimapCamera.fitBounds(target, { animateMs: REFIT_ANIMATE_MS });
    };
    if (mode === 'explore') {
      minimapCamera.fitBounds(roi, { paddingPx: ROI_FIT_PADDING_PX });
      roiOverview = true;
    } else {
      sync();
    }
    return mainCamera.onChange(sync);
  }, [mode, roi]);
}

/** Live bounds of a camera, refreshed on its rAF-coalesced onChange. */
function useCameraBounds(camera: Camera) {
  const [bounds, setBounds] = useState(() => camera.getBounds());
  useEffect(() => camera.onChange((s) => setBounds(s.bounds)), [camera]);
  return bounds;
}

function useCameraCenter(camera: Camera): LonLat {
  const [center, setCenter] = useState<LonLat>(() => camera.getState().center);
  useEffect(() => camera.onChange((s) => setCenter(s.center)), [camera]);
  return center;
}

function useCameraZoom(camera: Camera): number {
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

export function MinimapHeader() {
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

export function MinimapBody() {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const mode = useCampaignStore((s) => s.workMode);
  const { containerRef, width, height } = useContainerSize();
  const dragFrame = useRef<number | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const [previewBounds, setPreviewBounds] = useState<Bbox | null>(null);

  useMinimapFollow(mode, catalog.bbox);
  useEffect(() => () => dragCleanup.current?.(), []);

  const bounds = useCameraBounds(mainCamera);
  const minimapZoom = useCameraZoom(minimapCamera);
  const displayedBounds = previewBounds ?? bounds;

  const viewportCenterPixel =
    width > 0 && height > 0
      ? minimapCamera.containerPixelFromLonLat(centerOfBounds(displayedBounds), width, height)
      : null;

  // The dots stand for the same annotations the map draws, so they follow the
  // same filter - otherwise the overview would advertise work the map hides.
  const showTaskAnnotations = useImageryStore((s) => s.showTaskAnnotations);
  const [density, setDensity] = useState<AnnotationDensityCell[]>([]);
  useEffect(() => {
    if (mode !== 'explore') {
      setDensity([]);
      return;
    }
    let cancelled = false;
    void getAnnotationDensity({
      path: { campaign_id: catalog.campaignId },
      query: { include_tasks: showTaskAnnotations },
    })
      .then((res) => {
        if (!cancelled) setDensity(res.data ?? []);
      })
      .catch(() => {
        // best-effort overview; a failed fetch just leaves the map plain
      });
    return () => {
      cancelled = true;
    };
  }, [mode, catalog.campaignId, campaign.annotations_version, showTaskAnnotations]);

  const layers = useMemo<LayerSpec[]>(() => {
    const list: LayerSpec[] = [
      MINIMAP_BASEMAP,
      campaignBboxLayer(catalog.bbox),
      viewportRectLayer(displayedBounds),
    ];
    const density_ = densityLayer(density);
    if (density_) list.push(density_);
    return list;
  }, [catalog.bbox, displayedBounds, density]);

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
        mainCamera.moveTo({ center: target });
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
      watchBackgroundClick(e, startPoint);
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
