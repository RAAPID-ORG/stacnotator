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
import useAnnotationStore from '../annotation.store';
import { BASEMAP_LAYERS } from './Map/useSliceLayers';
import {
  computeTimeSlices,
  extractLatLonFromWKT,
  formatWindowLabel,
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

  // Read state directly from store
  const campaign = useAnnotationStore((state) => state.campaign);
  const allTasks = useAnnotationStore((state) => state.allTasks);
  const visibleTasks = useAnnotationStore((state) => state.visibleTasks);
  const taskFilter = useAnnotationStore((state) => state.taskFilter);
  const currentTaskIndex = useAnnotationStore((state) => state.currentTaskIndex);
  const selectedImageryId = useAnnotationStore((state) => state.selectedImageryId);
  const isEditingLayout = useAnnotationStore((state) => state.isEditingLayout);
  const currentLayout = useAnnotationStore((state) => state.currentLayout);
  const activeWindowId = useAnnotationStore((state) => state.activeWindowId);
  const activeSliceIndex = useAnnotationStore((state) => state.activeSliceIndex);
  const selectedLayerIndex = useAnnotationStore((state) => state.selectedLayerIndex);
  const showBasemap = useAnnotationStore((state) => state.showBasemap);
  const basemapType = useAnnotationStore((state) => state.basemapType);
  const currentMapBounds = useAnnotationStore((state) => state.currentMapBounds);
  const timeseriesPoint = useAnnotationStore((state) => state.timeseriesPoint);
  const probeTimeseriesPoint = useAnnotationStore((state) => state.probeTimeseriesPoint);
  const setCurrentLayout = useAnnotationStore((state) => state.setCurrentLayout);
  const setActiveWindowId = useAnnotationStore((state) => state.setActiveWindowId);
  const isSubmitting = useAnnotationStore((state) => state.isSubmitting);
  const submitAnnotation = useAnnotationStore((state) => state.submitAnnotation);
  const nextTask = useAnnotationStore((state) => state.nextTask);
  const previousTask = useAnnotationStore((state) => state.previousTask);
  const goToTask = useAnnotationStore((state) => state.goToTask);

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

  const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId) || null;
  const isOpenMode = campaign?.mode === 'open';
  const campaignBbox = campaign
    ? ([
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
      ] as [number, number, number, number])
    : null;

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

  const currentActiveWindowId = activeWindowId ?? selectedImagery?.default_main_window_id ?? null;
  const activeWindow = selectedImagery?.windows.find((w) => w.id === currentActiveWindowId);
  const visualizationName =
    selectedImagery?.visualization_url_templates?.[selectedLayerIndex]?.name;

  // Compute slices for the active window
  const slices = useMemo(() => {
    if (!activeWindow || !selectedImagery) return [];
    return computeTimeSlices(
      activeWindow.window_start_date,
      activeWindow.window_end_date,
      selectedImagery.slicing_interval,
      selectedImagery.slicing_unit
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- using ?.property for precise dependency tracking
  }, [
    activeWindow?.window_start_date,
    activeWindow?.window_end_date,
    selectedImagery?.slicing_interval,
    selectedImagery?.slicing_unit,
  ]);

  // Get the active slice for header display
  const activeSlice = slices[activeSliceIndex] ?? slices[0];

  // Memoize latLon extraction to prevent recalculations
  // In open mode with timeseries tool, use the clicked point; otherwise use task geometry
  const latLon = useMemo<LatLon | null>(() => {
    if (isOpenMode && timeseriesPoint) {
      return timeseriesPoint;
    }
    return currentTask ? extractLatLonFromWKT(currentTask.geometry.geometry) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when geometry changes
  }, [isOpenMode, timeseriesPoint, currentTask?.geometry.geometry]);

  // Memoize center to prevent array recreation on every render
  const center = useMemo<[number, number]>(
    () => (latLon ? [latLon.lat, latLon.lon] : [0, 0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when lat/lon change
    [latLon?.lat, latLon?.lon]
  );

  if (!campaign) return null;

  const renderMainHeader = () => {
    // Get the current layer name
    const currentLayerName = showBasemap
      ? BASEMAP_LAYERS.find((b) => b.id === basemapType)?.name ?? 'Basemap'
      : visualizationName || 'Layer';

    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-neutral-900">
          {/* Always show layer name */}
          <span className="font-medium">{currentLayerName}</span>

          {/* Show imagery source and dates if not basemap */}
          {!showBasemap && selectedImagery && (
            <>
              <span className="text-neutral-400">·</span>
              <span className="text-neutral-600">{selectedImagery.name}</span>
              {activeSlice ? (
                <>
                  <span className="text-neutral-400">·</span>
                  <span className="text-neutral-600">{activeSlice.label}</span>
                </>
              ) : (
                activeWindow && (
                  <>
                    <span className="text-neutral-400">·</span>
                    <span className="text-neutral-600">
                      {formatWindowLabel(
                        activeWindow.window_start_date,
                        activeWindow.window_end_date,
                        selectedImagery.window_unit || null
                      )}
                    </span>
                  </>
                )
              )}
              {slices.length > 1 && (
                <span className="text-neutral-500">
                  ({activeSliceIndex + 1}/{slices.length})
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
            href={`https://www.google.com/maps?q=${latLon.lat},${latLon.lon}&t=k`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-0.5 hover:bg-neutral-200 rounded transition-colors"
            title="Open in Google Maps (satellite view)"
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
      className={`flex-1 relative bg-base overflow-y-auto overflow-x-hidden ${isFullscreen! ? 'p-3' : 'p-1'} ${
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
          <div key="main" className="grid-card">
            <div className={`drag-handle card-header !py-0.5 ${isEditingLayout ? 'editable' : ''}`}>
              {renderMainHeader()}
            </div>
            <MainAnnotationsContainer commentInputRef={commentInputRef} />
          </div>

          {/* Timeseries */}
          {campaign.time_series.length > 0 && (
            <div key="timeseries" className="grid-card">
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
          <div key="minimap" className="grid-card">
            <div className={`drag-handle card-header !py-0.5 ${isEditingLayout ? 'editable' : ''}`}>
              {renderMinimapHeader()}
            </div>
            <MiniMap
              center={center}
              bbox={campaignBbox || [0, 0, 0, 0]}
              visibleBounds={campaign?.mode === 'open' ? currentMapBounds : null}
            />
          </div>

          {/* Annotation Controls Panel */}
          <div key="controls" className="grid-card">
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

          {/* Imagery Windows */}
          {selectedImagery?.windows.map((window) => {
            const isActiveWindow = window.id === currentActiveWindowId;

            return (
              <div
                key={window.id}
                className={`grid-card grid-card-hoverable ${isActiveWindow ? 'active-window' : ''}`}
              >
                <div
                  className={`drag-handle card-header !py-0.5 ${isEditingLayout ? 'editable' : ''} cursor-pointer hover:bg-brand-50`}
                  onClick={() => setActiveWindowId(window.id)}
                >
                  {formatWindowLabel(
                    window.window_start_date,
                    window.window_end_date,
                    selectedImagery.window_unit
                  )}
                </div>
                <ImageryContainer window={window} />
              </div>
            );
          })}
        </ReactGridLayout>
      )}
    </main>
  );
};
