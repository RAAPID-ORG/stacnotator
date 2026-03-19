import { useMemo, useRef, useState, useEffect } from 'react';
import ReactGridLayout, { getCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import ImageryContainer from './ImageryContainer';
import MiniMap from './Minimap';
import MainAnnotationsContainer from './MainAnnotationContainer';
import { TimeSeriesChart } from './TimeSeries/TimeSeriesChart';
import ControlsTaskMode from './ControlsTaskMode';
import ControlsOpenMode from './ControlsOpenMode';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { useAnnotationStore } from '../stores/annotation.store';
import {
  extractLatLonFromWKT,
  convertWKTToGeoJSON,
  type LatLon,
} from '~/shared/utils/utility';
import { useLayoutStore } from '~/features/layout/layout.store';

/**
 * Copy text to clipboard
 */
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }
};

interface CanvasProps {
  commentInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Canvas component managing the grid layout of annotation panels
 */
export const Canvas = ({ commentInputRef }: CanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  // Read state directly from stores
  const campaign = useCampaignStore((s) => s.campaign);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const isEditingLayout = useCampaignStore((s) => s.isEditingLayout);
  const currentLayout = useCampaignStore((s) => s.currentLayout);
  const setCurrentLayout = useCampaignStore((s) => s.setCurrentLayout);

  const allTasks = useTaskStore((s) => s.allTasks);
  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const taskFilter = useTaskStore((s) => s.taskFilter);
  const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);
  const isSubmitting = useTaskStore((s) => s.isSubmitting);
  const submitAnnotation = useTaskStore((s) => s.submitAnnotation);
  const nextTask = useTaskStore((s) => s.nextTask);
  const previousTask = useTaskStore((s) => s.previousTask);
  const goToTask = useTaskStore((s) => s.goToTask);

  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
  const showBasemap = useMapStore((s) => s.showBasemap);
  const selectedBasemapId = useMapStore((s) => s.selectedBasemapId);
  const currentMapBounds = useMapStore((s) => s.currentMapBounds);
  const triggerPanToCenter = useMapStore((s) => s.triggerPanToCenter);
  const timeseriesPoint = useMapStore((s) => s.timeseriesPoint);
  const probeTimeseriesPoint = useMapStore((s) => s.probeTimeseriesPoint);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);

  // Get fullscreen state from UI store
  const isFullscreen = useLayoutStore((state) => state.isFullscreen);

  // Compute derived values
  const currentTask = visibleTasks[currentTaskIndex] || null;

  // For counter: show tasks matching current assignedTo filter (regardless of status filter)
  const tasksInAssignmentScope = allTasks.filter((task) => {
    if (taskFilter.assignedTo.length === 0) return true; // All users
    const assignments = task.assignments || [];
    return assignments.some((a) => taskFilter.assignedTo.includes(a.user_id));
  });
  const totalTasksForCounter = tasksInAssignmentScope.length;
  const completedTasksForCounter = tasksInAssignmentScope.filter((task) => {
    return task.task_status === 'done' || task.task_status === 'skipped' || task.task_status === 'conflicting';
  }).length;

  const selectedView = campaign?.imagery_views?.find((v) => v.id === selectedViewId) ?? null;
  const isOpenMode = campaign?.mode === 'open';
  const campaignBbox = campaign
    ? ([
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
      ] as [number, number, number, number])
    : null;

  // Annotation dots for the minimap (open mode only)
  const annotations = useAnnotationStore((s) => s.annotations);
  const annotationDots = useMemo(() => {
    if (!isOpenMode) return undefined;
    return annotations
      .map((ann) => {
        const geojson = convertWKTToGeoJSON(ann.geometry.geometry);
        if (!geojson) return null;
        // Compute centroid from geometry coordinates
        const coords = geojson.type === 'Point'
          ? [geojson.coordinates as [number, number]]
          : geojson.type === 'Polygon'
            ? (geojson.coordinates as number[][][])[0]
            : geojson.type === 'LineString'
              ? (geojson.coordinates as number[][])
              : [];
        if (coords.length === 0) return null;
        const sumLon = coords.reduce((s, c) => s + (c as number[])[0], 0);
        const sumLat = coords.reduce((s, c) => s + (c as number[])[1], 0);
        return { lat: sumLat / coords.length, lon: sumLon / coords.length };
      })
      .filter((d): d is { lat: number; lon: number } => d !== null);
  }, [isOpenMode, annotations]);

  // Collections shown as windows in the current view
  const windowCollections = useMemo(() => {
    if (!campaign || !selectedView) return [];
    return selectedView.collection_refs
      .filter((ref) => ref.show_as_window)
      .map((ref) => {
        const source = campaign.imagery_sources.find((s) => s.id === ref.source_id);
        const collection = source?.collections.find((c) => c.id === ref.collection_id);
        return { ...ref, collection, source };
      })
      .filter((r) => r.collection && r.source);
  }, [campaign, selectedView]);

  // Resolve active collection and source for header display
  const activeSource = useMemo(() => {
    if (!campaign || !activeCollectionId) return null;
    return campaign.imagery_sources.find((s) =>
      s.collections.some((c) => c.id === activeCollectionId),
    ) ?? null;
  }, [campaign, activeCollectionId]);

  const activeCollection = activeSource?.collections.find((c) => c.id === activeCollectionId) ?? null;
  const activeSlice = activeCollection?.slices[activeSliceIndex] ?? null;

  // Visualization name for header
  const allVizEntries = (campaign?.imagery_sources ?? []).flatMap((src) =>
    src.visualizations.map((v) => ({ sourceName: src.name, vizName: v.name })),
  );
  const activeVizEntry = allVizEntries[selectedLayerIndex] ?? allVizEntries[0] ?? null;

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });

    resizeObserver.observe(containerRef.current);
    setIsMounted(true);

    return () => resizeObserver.disconnect();
  }, []);

  // Memoize latLon extraction to prevent recalculations
  // In open mode with timeseries tool, use the clicked point; otherwise use task geometry
  const latLon = useMemo<LatLon | null>(() => {
    if (isOpenMode && timeseriesPoint) {
      return timeseriesPoint;
    }
    return currentTask ? extractLatLonFromWKT(currentTask.geometry.geometry) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpenMode, timeseriesPoint, currentTask?.geometry.geometry]);

  // Memoize center to prevent array recreation on every render
  const center = useMemo<[number, number]>(
    () => (latLon ? [latLon.lat, latLon.lon] : [0, 0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latLon?.lat, latLon?.lon]
  );

  if (!campaign) return null;

  const renderMainHeader = () => {
    const currentLayerName = showBasemap
      ? (campaign.basemaps.find((b) => `basemap-${b.id}` === selectedBasemapId)?.name ?? 'Basemap')
      : (activeVizEntry?.vizName || 'Layer');

    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-neutral-900">
          <span className="font-medium">{currentLayerName}</span>

          {!showBasemap && activeSource && (
            <>
              <span className="text-neutral-400">·</span>
              <span className="text-neutral-600">{activeSource.name}</span>
              {activeSlice && (
                <>
                  <span className="text-neutral-400">·</span>
                  <span className="text-neutral-600">{activeSlice.name}</span>
                </>
              )}
              {(activeCollection?.slices.length ?? 0) > 1 && (
                <span className="text-neutral-500">
                  ({activeSliceIndex + 1}/{activeCollection!.slices.length})
                </span>
              )}
            </>
          )}
        </div>
        {!isOpenMode && (
          <div className="text-xs text-neutral-900">
            {completedTasksForCounter}/{totalTasksForCounter} tasks done
          </div>
        )}
      </div>
    );
  };

  const renderMinimapHeader = () => (
    <div className="flex flex-col gap-0">
      <span>Minimap</span>
      {latLon && (
        <div className="flex items-center gap-1.5 font-normal text-neutral-900 text-[10px] -mt-1">
          <span>
            lat: {latLon.lat.toFixed(5)} | lon: {latLon.lon.toFixed(5)}
          </span>
          <button
            onClick={() => copyToClipboard(`${latLon.lat},${latLon.lon}`)}
            className="p-0.5 hover:bg-neutral-200 rounded transition-colors"
            title="Copy coordinates to clipboard"
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
          </button>
          <a
            href={`https://earth.google.com/web/search/${latLon.lat},${latLon.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-0.5 hover:bg-neutral-200 rounded transition-colors"
            title="Open in Google Earth"
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>
        </div>
      )}
    </div>
  );

  return (
    <main
      ref={containerRef}
      className={`flex-1 min-h-0 relative bg-base overflow-y-auto overflow-x-hidden ${isFullscreen! ? 'p-3' : 'p-1'} ${
        isEditingLayout ? 'is-editing' : ''
      }`}
    >
      {isMounted && currentLayout && (
        <ReactGridLayout
          width={containerWidth}
          layout={currentLayout}
          gridConfig={{
            cols: 60,
            rowHeight: 15,
            margin: [4, 4],
          }}
          dragConfig={{
            enabled: isEditingLayout,
          }}
          resizeConfig={{
            enabled: isEditingLayout,
            handles: ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne'],
          }}
          compactor={getCompactor(null, false, true)}
          onLayoutChange={setCurrentLayout}
        >
          {/* Main Annotation Container */}
          <div key="main" className="grid-card" data-tour="main-map">
            <div className={`drag-handle card-header !py-0.5 ${isEditingLayout ? 'editable' : ''}`}>
              {renderMainHeader()}
            </div>
            <MainAnnotationsContainer commentInputRef={commentInputRef} />
          </div>

          {/* Timeseries */}
          {campaign.time_series.length > 0 && (
            <div key="timeseries" className="grid-card" data-tour="timeseries">
              <div
                className={`drag-handle card-header !py-0.5 ${isEditingLayout ? 'editable' : ''}`}
              >
                <span>Time Series</span>
              </div>
              <TimeSeriesChart
                timeseries={campaign.time_series}
                latLon={latLon}
                prefetchCoordinates={visibleTasks
                  .slice(currentTaskIndex + 1, currentTaskIndex + 4)
                  .map((task) => extractLatLonFromWKT(task.geometry.geometry))
                  .filter((coord): coord is LatLon => coord !== null)}
                probeLatLon={!isOpenMode ? probeTimeseriesPoint : undefined}
              />
            </div>
          )}

          {/* Minimap */}
          <div key="minimap" className="grid-card" data-tour="minimap">
            <div className={`drag-handle card-header !py-0.5 ${isEditingLayout ? 'editable' : ''}`}>
              {renderMinimapHeader()}
            </div>
            <MiniMap
              center={center}
              bbox={campaignBbox || [0, 0, 0, 0]}
              visibleBounds={campaign?.mode === 'open' ? currentMapBounds : null}
              onViewportDrag={campaign?.mode === 'open' ? (lat, lon) => triggerPanToCenter([lat, lon]) : undefined}
              fitBbox={campaign?.mode === 'tasks'}
              annotationDots={annotationDots}
            />
          </div>

          {/* Annotation Controls Panel */}
          <div key="controls" className="grid-card" data-tour="controls">
            <div className="h-full overflow-auto">
              {campaign.mode === 'tasks' ? (
                <ControlsTaskMode
                  labels={campaign.settings.labels}
                  onSubmit={submitAnnotation}
                  onNext={nextTask}
                  onPrevious={previousTask}
                  onGoToTask={goToTask}
                  isSubmitting={isSubmitting}
                  totalTasksCount={visibleTasks.length}
                  currentTask={currentTask}
                  commentInputRef={commentInputRef}
                />
              ) : (
                <ControlsOpenMode />
              )}
            </div>
          </div>

          {/* Collection Windows */}
          {windowCollections.map(({ collection, source }, idx) => {
            if (!collection || !source) return null;
            const isActiveCol = collection.id === activeCollectionId;

            return (
              <div
                key={collection.id}
                className={`grid-card grid-card-hoverable ${isActiveCol ? 'active-window' : ''}`}
                {...(idx === 0 ? { 'data-tour': 'imagery-windows' } : {})}
              >
                <div
                  className={`drag-handle card-header !py-0.5 ${isEditingLayout ? 'editable' : ''} cursor-pointer hover:bg-brand-50`}
                  onClick={() => setActiveCollectionId(collection.id)}
                >
                  {collection.name}
                </div>
                <ImageryContainer collectionId={collection.id} sourceId={source.id} />
              </div>
            );
          })}
        </ReactGridLayout>
      )}
    </main>
  );
};
