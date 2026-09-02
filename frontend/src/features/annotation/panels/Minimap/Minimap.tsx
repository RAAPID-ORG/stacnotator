import { useEffect, useMemo, useState } from 'react';
import { getAnnotationDensity, type AnnotationDensityCell } from '~/api/client';
import { IconExternalLink } from '~/shared/ui/Icons';
import { type GeocodingResult } from '~/shared/map/geocoding';
import { LocationSearch } from '~/shared/map/LocationSearch';
import { useCameraCenter } from '~/shared/map/Camera';
import { Minimap } from '~/shared/map/minimap/Minimap';
import { tasksModeTarget, useOverviewFollow } from '~/shared/map/minimap/follow';
import { type Bbox, type FeatureLayerSpec, type LayerSpec, type LonLat } from '~/shared/map/types';
import { useCampaignStore, useCatalog, type WorkMode } from '../../stores/campaign';
import { useWorkStore } from '../../stores/work';
import { useImageryStore } from '../../stores/imagery';
import { useMapFocus } from '../../stores/tasks';
import { mainCamera, minimapCamera } from '../../map/camera';

/** Task mode opens the overview on the task at a fixed zoom and then leaves it
 *  alone: what it is about is the pin, not where the main map happens to look,
 *  so the user is free to pan and zoom around it (Space brings it back).
 *  Explore opens on the campaign ROI and tracks the main camera from there. */
function useMinimapFollow(mode: WorkMode, roi: Bbox, taskCenter: LonLat | null): void {
  useOverviewFollow(minimapCamera, mainCamera, roi, mode === 'explore');
  useEffect(() => {
    if (mode !== 'tasks' || !taskCenter) return;
    minimapCamera.moveTo(tasksModeTarget(taskCenter));
  }, [mode, taskCenter]);
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

/** The live centre, and the two things that act on it, as leaves of their own: the
 *  camera publishes a snapshot on every frame it moves, and the header holds the
 *  location search box, which must not re-render with it. */
function ViewportCenter() {
  const center = useCameraCenter(mainCamera);
  return (
    <span
      data-testid="viewport-center"
      className="truncate text-xs font-medium tabular-nums text-neutral-700"
    >
      {center[1].toFixed(5)}, {center[0].toFixed(5)}
    </span>
  );
}

function CenterActions() {
  const center = useCameraCenter(mainCamera);

  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() =>
          void navigator.clipboard?.writeText(`${center[1].toFixed(5)},${center[0].toFixed(5)}`)
        }
        title="Copy coordinates to clipboard"
        className="p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 rounded transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
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
  );
}

export function MinimapHeader() {
  const [expanded, setExpanded] = useState(false);

  const onSelect = (result: GeocodingResult) => {
    mainCamera.moveTo({ center: result.center });
    if (result.extent) mainCamera.fitBounds(result.extent, { paddingPx: 40, animateMs: 300 });
  };

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      {!expanded && <ViewportCenter />}
      <div
        className={`flex min-w-0 items-center gap-0.5 ${expanded ? 'flex-1' : 'ml-auto shrink-0'}`}
      >
        {!expanded && <CenterActions />}
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

/** Long enough that drawing several shapes in a row is one request. */
const DENSITY_DEBOUNCE_MS = 600;

export function MinimapBody() {
  const catalog = useCatalog();
  const mode = useCampaignStore((s) => s.workMode);
  const focus = useMapFocus();
  const pin = mode === 'tasks' ? (focus?.center ?? null) : null;

  useMinimapFollow(mode, catalog.bbox, pin);

  // The dots stand for the same annotations the map draws, so they follow the
  // same filter - otherwise the overview would advertise work the map hides.
  const showTaskAnnotations = useImageryStore((s) => s.showTaskAnnotations);
  // A drawn shape has to reach the overview too. The campaign's stored
  // annotations_version is read once at page load and never refreshed, so it
  // cannot say that; the work store's revision counts every write and delete
  // this page sees, its own and the poll's.
  const annotationRevision = useWorkStore((s) => s.annotationRevision);
  const [density, setDensity] = useState<AnnotationDensityCell[]>([]);
  useEffect(() => {
    if (mode !== 'explore') {
      setDensity([]);
      return;
    }
    let cancelled = false;
    // The endpoint aggregates the whole campaign, so a burst of drawing waits
    // for the pause rather than asking once per shape.
    const timer = setTimeout(
      () => {
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
      },
      annotationRevision === 0 ? 0 : DENSITY_DEBOUNCE_MS
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, catalog.campaignId, annotationRevision, showTaskAnnotations]);

  const layers = useMemo<LayerSpec[]>(() => {
    const cells = densityLayer(density);
    return cells ? [cells] : [];
  }, [density]);

  return (
    <Minimap
      camera={minimapCamera}
      main={mainCamera}
      roi={catalog.bbox}
      layers={layers}
      // In task mode the main map belongs to the task, not to the person
      // looking at it - a stray click here used to sail off the task location.
      jumpOnClick={mode === 'explore'}
      pin={pin}
    />
  );
}
