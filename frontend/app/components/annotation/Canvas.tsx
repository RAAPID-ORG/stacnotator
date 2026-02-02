import { useMemo, useRef, useState, useEffect } from 'react';
import ReactGridLayout, { getCompactor, noCompactor, type CompactType } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import {
  extractLatLonFromWKT,
  computeTimeSlices,
  formatWindowLabel,
  type LatLon,
} from '~/utils/utility';
import { useAnnotationStore } from '~/stores/annotationStore';
import { useUIStore } from '~/stores/uiStore';
import { timeseriesCache } from '~/utils/timeseriesCache';
import ImageryContainer from './ImageryContainer';
import MiniMap from './Minimap';
import MainAnnotationsContainer from './MainAnnotationContainer';
import TimeSeriesContainer from './TimeSeriesContainer';

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
  const totalTasksForCounter = useAnnotationStore((state) => state.totalTasksForCounter);
  const completedTasksForCounter = useAnnotationStore((state) => state.completedTasksForCounter);
  const pendingTasks = useAnnotationStore((state) => state.pendingTasks);
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
  const setCurrentLayout = useAnnotationStore((state) => state.setCurrentLayout);
  const setActiveWindowId = useAnnotationStore((state) => state.setActiveWindowId);

  // Get fullscreen state from UI store
  const isFullscreen = useUIStore((state) => state.isFullscreen);

  // Compute derived values
  const currentTask = pendingTasks[currentTaskIndex] || null;
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

  // Prefetch timeseries data for next 3 tasks
  useEffect(() => {
    if (!campaign || pendingTasks.length === 0) return;

    const timeseriesIds = campaign.time_series.map((ts) => ts.id);
    if (timeseriesIds.length === 0) return;

    // Prefetch next 3 tasks (skip current task as it's already being loaded by TimeSeriesContainer)
    const tasksToPreload = pendingTasks.slice(currentTaskIndex + 1, currentTaskIndex + 4);

    tasksToPreload.forEach((task) => {
      const taskLatLon = extractLatLonFromWKT(task.geometry.geometry);
      if (taskLatLon) {
        timeseriesCache.prefetch(timeseriesIds, taskLatLon.lat, taskLatLon.lon);
      }
    });
  }, [campaign, pendingTasks, currentTaskIndex]);

  if (!campaign) return null;

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
  }, [isOpenMode, timeseriesPoint, currentTask?.geometry.geometry]);

  // Memoize center to prevent array recreation on every render
  const center = useMemo<[number, number]>(
    () => (latLon ? [latLon.lat, latLon.lon] : [0, 0]),
    [latLon?.lat, latLon?.lon]
  );

  const renderMainHeader = () => {
    // Get the current layer name
    const currentLayerName = showBasemap
      ? (basemapType === 'esri-world-imagery' ? 'ESRI World Imagery' : 'CartoDB Light')
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
        <div className="text-xs text-neutral-900">
          {completedTasksForCounter}/{totalTasksForCounter} tasks done
        </div>
      </div>
    );
  };

  const renderMinimapHeader = () => (
    <div className="flex flex-col gap-0">
      <span>Minimap</span>
      {latLon && (
        <span className="font-normal text-neutral-900 text-[10px] -mt-1">
          lat: {latLon.lat.toFixed(5)} | lon: {latLon.lon.toFixed(5)}
        </span>
      )}
    </div>
  );

  return (
    <main
      ref={containerRef}
      className={`flex-1 relative bg-base overflow-y-auto overflow-x-hidden ${isFullscreen ? 'p-3' : 'p-1'} ${
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
            handle: '.drag-handle',
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
              <TimeSeriesContainer timeseries={campaign.time_series} latLon={latLon} />
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
