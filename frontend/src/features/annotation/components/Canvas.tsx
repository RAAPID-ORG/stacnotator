import { useMemo, useRef } from 'react';
import ReactGridLayout, { getCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import ImageryContainer from './ImageryContainer';
import { WindowSliceSelect } from './WindowSliceSelect';
import MiniMap from './Minimap';
import MainAnnotationsContainer from './MainAnnotationContainer';
import { TimeSeriesChart } from './TimeSeries/TimeSeriesChart';
import ControlsTaskMode from './ControlsTaskMode';
import ControlsOpenMode from './ControlsOpenMode';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { extractCentroidFromWKT, convertWKTToGeoJSON, type LatLon } from '~/shared/utils/utility';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useContainerWidth } from '../hooks/useContainerWidth';

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

export const Canvas = ({ commentInputRef }: CanvasProps) => {
  const { containerRef, containerWidth, isMounted } = useContainerWidth();
  const headerControlsRef = useRef<HTMLDivElement>(null);

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
  const currentMapCenter = useMapStore((s) => s.currentMapCenter);
  const triggerPanToCenter = useMapStore((s) => s.triggerPanToCenter);
  const timeseriesPoint = useMapStore((s) => s.timeseriesPoint);
  const probeTimeseriesPoint = useMapStore((s) => s.probeTimeseriesPoint);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);

  const isFullscreen = useLayoutStore((state) => state.isFullscreen);

  const currentTask = visibleTasks[currentTaskIndex] || null;

  // Counter scope: assignedTo filter only, ignoring the status filter so the
  // progress number reflects the user's full workload, not the filtered view.
  const tasksInAssignmentScope = allTasks.filter((task) => {
    if (taskFilter.assignedTo.length === 0) return true;
    const assignments = task.assignments || [];
    return assignments.some((a) => taskFilter.assignedTo.includes(a.user_id));
  });
  const totalTasksForCounter = tasksInAssignmentScope.length;
  const completedTasksForCounter = tasksInAssignmentScope.filter((task) => {
    return (
      task.task_status === 'done' ||
      task.task_status === 'skipped' ||
      task.task_status === 'conflicting'
    );
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

  // Annotation dots for the minimap (open mode only).
  const annotations = useAnnotationStore((s) => s.annotations);
  const annotationDots = useMemo(() => {
    if (!isOpenMode) return undefined;
    return annotations
      .map((ann) => {
        const geojson = convertWKTToGeoJSON(ann.geometry.geometry);
        if (!geojson) return null;
        const coords =
          geojson.type === 'Point'
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

  const activeSource = useMemo(() => {
    if (!campaign || !activeCollectionId) return null;
    return (
      campaign.imagery_sources.find((s) =>
        s.collections.some((c) => c.id === activeCollectionId)
      ) ?? null
    );
  }, [campaign, activeCollectionId]);

  const activeCollection =
    activeSource?.collections.find((c) => c.id === activeCollectionId) ?? null;
  const activeSlice = activeCollection?.slices[activeSliceIndex] ?? null;

  const activeSourceVizName = (() => {
    if (!activeSource || !campaign) return null;
    let offset = 0;
    for (const s of campaign.imagery_sources) {
      if (s.id === activeSource.id) break;
      offset += s.visualizations.length;
    }
    const idx = Math.max(0, selectedLayerIndex - offset);
    return (
      activeSource.visualizations[Math.min(idx, activeSource.visualizations.length - 1)]?.name ??
      null
    );
  })();

  // Open mode: viewport center. Task mode: task geometry centroid.
  const latLon = useMemo<LatLon | null>(() => {
    if (isOpenMode) {
      if (currentMapCenter) return { lat: currentMapCenter[0], lon: currentMapCenter[1] };
      return null;
    }
    return currentTask ? extractCentroidFromWKT(currentTask.geometry.geometry) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpenMode, currentMapCenter?.[0], currentMapCenter?.[1], currentTask?.geometry.geometry]);

  // Open mode only sends a timeseries point when explicitly clicked with the
  // timeseries tool; task mode always uses the task centroid.
  const timeseriesLatLon = useMemo<LatLon | null>(() => {
    if (isOpenMode) return timeseriesPoint;
    return latLon;
  }, [isOpenMode, timeseriesPoint, latLon]);

  const center = useMemo<[number, number]>(
    () => (latLon ? [latLon.lat, latLon.lon] : [0, 0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latLon?.lat, latLon?.lon]
  );

  if (!campaign) return null;

  const renderMainHeader = () => {
    const taskStatus = currentTask?.task_status as
      | 'pending'
      | 'partial'
      | 'done'
      | 'conflicting'
      | 'skipped'
      | undefined;
    const statusDotColor: Record<NonNullable<typeof taskStatus>, string> = {
      pending: 'bg-neutral-300',
      partial: 'bg-amber-500',
      done: 'bg-brand-600',
      conflicting: 'bg-orange-500',
      skipped: 'bg-violet-500',
    };

    const progressPct =
      totalTasksForCounter > 0
        ? Math.round((completedTasksForCounter / totalTasksForCounter) * 100)
        : 0;

    return (
      <div className="flex items-center justify-between gap-3 w-full">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          {!isOpenMode && currentTask ? (
            <>
              {taskStatus && (
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotColor[taskStatus]}`}
                  title={taskStatus}
                  aria-hidden
                />
              )}
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                Point
              </span>
              <span className="text-xs font-semibold text-neutral-900 tabular-nums">
                {currentTask.annotation_number}
              </span>
            </>
          ) : (
            <span className="text-xs font-medium text-neutral-700 truncate">
              {showBasemap
                ? (campaign.basemaps.find((b) => `basemap-${b.id}` === selectedBasemapId)?.name ??
                  'Basemap')
                : activeSourceVizName || 'Layer'}
            </span>
          )}
        </div>

        {/* Slot for map controls (selectors + actions), filled via portal from MainAnnotationContainer */}
        <div
          ref={headerControlsRef}
          className="flex items-center gap-2 min-w-0 flex-1 justify-end"
          data-tour="map-controls"
        />

        {!isOpenMode ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-neutral-500">
              <span className="font-semibold text-neutral-900 tabular-nums">
                {completedTasksForCounter}
              </span>{' '}
              of <span className="tabular-nums">{totalTasksForCounter}</span> done
            </span>
            <span className="text-[11px] text-neutral-400 tabular-nums">· {progressPct}%</span>
          </div>
        ) : (
          !showBasemap &&
          activeSource && (
            <span className="text-[11px] text-neutral-500 truncate shrink-0">
              {activeSource.name}
              {activeSlice && ` · ${activeSlice.name}`}
            </span>
          )
        )}
      </div>
    );
  };

  const renderMinimapHeader = () => (
    <div className="flex items-center gap-2 w-full min-w-0">
      <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider shrink-0">
        Loc
      </span>
      {latLon ? (
        <>
          <span className="tabular-nums text-xs text-neutral-700 font-medium truncate">
            {latLon.lat.toFixed(5)}, {latLon.lon.toFixed(5)}
          </span>
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            <button
              onClick={() => copyToClipboard(`${latLon.lat},${latLon.lon}`)}
              className="p-1 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
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
              className="p-1 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
              title="Open in Google Earth"
              onClick={(e) => e.stopPropagation()}
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </a>
          </div>
        </>
      ) : (
        <span className="text-[11px] text-neutral-400 italic">no position</span>
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
            margin: [6, 6],
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
          <div key="main" className="grid-card" data-tour="main-map">
            <div className={`drag-handle card-header ${isEditingLayout ? 'editable' : ''}`}>
              {renderMainHeader()}
            </div>
            <MainAnnotationsContainer
              commentInputRef={commentInputRef}
              headerSlotRef={headerControlsRef}
            />
          </div>

          {campaign.time_series.length > 0 && (
            <div key="timeseries" className="grid-card" data-tour="timeseries">
              {isEditingLayout && (
                <div className={`drag-handle card-header ${isEditingLayout ? 'editable' : ''}`}>
                  <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                    Time series
                  </span>
                </div>
              )}
              <TimeSeriesChart
                timeseries={campaign.time_series}
                latLon={timeseriesLatLon}
                prefetchCoordinates={visibleTasks
                  .slice(currentTaskIndex + 1, currentTaskIndex + 4)
                  .map((task) => extractCentroidFromWKT(task.geometry.geometry))
                  .filter((coord): coord is LatLon => coord !== null)}
                probeLatLon={!isOpenMode ? probeTimeseriesPoint : undefined}
              />
            </div>
          )}

          <div key="minimap" className="grid-card" data-tour="minimap">
            <div className={`drag-handle card-header ${isEditingLayout ? 'editable' : ''}`}>
              {renderMinimapHeader()}
            </div>
            <MiniMap
              center={center}
              bbox={campaignBbox || [0, 0, 0, 0]}
              visibleBounds={campaign?.mode === 'open' ? currentMapBounds : null}
              onViewportDrag={
                campaign?.mode === 'open' ? (lat, lon) => triggerPanToCenter([lat, lon]) : undefined
              }
              fitBbox={campaign?.mode === 'tasks'}
              annotationDots={annotationDots}
            />
          </div>

          <div key="controls" className="grid-card" data-tour="controls">
            <div className="h-full overflow-y-auto overflow-x-hidden">
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
                  className={`drag-handle card-header !py-0.5 !gap-2 group/header ${isEditingLayout ? 'editable' : ''} cursor-pointer hover:bg-neutral-50 ${isActiveCol ? '!bg-brand-600 !text-white !border-b-brand-600' : ''}`}
                  onClick={() => setActiveCollectionId(collection.id)}
                  title={`${source.name} - ${collection.name}`}
                >
                  <span className="truncate flex-1 min-w-0">
                    <span
                      className={`hidden group-hover/header:inline ${isActiveCol ? 'text-white/70' : 'text-neutral-400'}`}
                    >
                      {source.name}
                      <span className="mx-1">›</span>
                    </span>
                    {collection.name}
                  </span>
                  <WindowSliceSelect collection={collection} darkBg={isActiveCol} />
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
