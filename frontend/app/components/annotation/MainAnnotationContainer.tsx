import { useState, useMemo, useEffect } from 'react';
import { extractLatLonFromWKT, computeTimeSlices } from '~/utils/utility';
import { useAnnotationStore } from '~/stores/annotationStore';
import AnnotationControls from './AnnotationControls';
import LeafletMap from './LeafletMap';
import LeafletMapWithDraw from './LeafletMapWithDraw';
import TimelineSidebar from './TimelineSidebar';
import { useStacImagery } from '~/hooks/useStacImagery';
import OpenModeControls, { extendLabelsWithMetadata, type ExtendedLabel } from './OpenModeControls';

interface MainAnnotationsContainerProps {
  commentInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Main annotation container
 * Coordinates map display, timeline, and annotation controls
 */
export const MainAnnotationsContainer = ({ commentInputRef }: MainAnnotationsContainerProps) => {
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [showLayerDropdown, setShowLayerDropdown] = useState(false);

  // Get state from store
  const campaign = useAnnotationStore((state) => state.campaign);
  const selectedImageryId = useAnnotationStore((state) => state.selectedImageryId);
  const visibleTasks = useAnnotationStore((state) => state.visibleTasks);
  const currentTaskIndex = useAnnotationStore((state) => state.currentTaskIndex);
  const allTasks = useAnnotationStore((state) => state.allTasks);
  const activeWindowId = useAnnotationStore((state) => state.activeWindowId);
  const activeSliceIndex = useAnnotationStore((state) => state.activeSliceIndex);
  const selectedLayerIndex = useAnnotationStore((state) => state.selectedLayerIndex);
  const selectedLabelId = useAnnotationStore((state) => state.selectedLabelId);
  const activeTool = useAnnotationStore((state) => state.activeTool);
  const showBasemap = useAnnotationStore((state) => state.showBasemap);
  const basemapType = useAnnotationStore((state) => state.basemapType);
  const magicWandEnabled = useAnnotationStore((state) => state.magicWandEnabled);
  const refocusTrigger = useAnnotationStore((state) => state.refocusTrigger);
  const showCrosshair = useAnnotationStore((state) => state.showCrosshair);
  const zoomInTrigger = useAnnotationStore((state) => state.zoomInTrigger);
  const zoomOutTrigger = useAnnotationStore((state) => state.zoomOutTrigger);
  const panTrigger = useAnnotationStore((state) => state.panTrigger);
  const isSubmitting = useAnnotationStore((state) => state.isSubmitting);
  const currentMapCenter = useAnnotationStore((state) => state.currentMapCenter);
  const currentMapZoom = useAnnotationStore((state) => state.currentMapZoom);
  const setActiveWindowId = useAnnotationStore((state) => state.setActiveWindowId);
  const setActiveSliceIndex = useAnnotationStore((state) => state.setActiveSliceIndex);
  const setSelectedLayerIndex = useAnnotationStore((state) => state.setSelectedLayerIndex);
  const setSelectedLabelId = useAnnotationStore((state) => state.setSelectedLabelId);
  const setShowBasemap = useAnnotationStore((state) => state.setShowBasemap);
  const setBasemapType = useAnnotationStore((state) => state.setBasemapType);
  const triggerRefocus = useAnnotationStore((state) => state.triggerRefocus);
  const toggleCrosshair = useAnnotationStore((state) => state.toggleCrosshair);
  const submitAnnotation = useAnnotationStore((state) => state.submitAnnotation);
  const nextTask = useAnnotationStore((state) => state.nextTask);
  const previousTask = useAnnotationStore((state) => state.previousTask);
  const goToTask = useAnnotationStore((state) => state.goToTask);
  const setMapCenter = useAnnotationStore((state) => state.setMapCenter);
  const setMapZoom = useAnnotationStore((state) => state.setMapZoom);
  const setMapBounds = useAnnotationStore((state) => state.setMapBounds);
  const setTimeseriesPoint = useAnnotationStore((state) => state.setTimeseriesPoint);

  // Compute derived values
  const currentTask = visibleTasks[currentTaskIndex] || null;
  const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId) || null;
  const campaignBbox = campaign
    ? ([
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
      ] as [number, number, number, number])
    : null;

  if (!campaign || !selectedImagery || !campaignBbox) return null;

  const labels = campaign.settings.labels;
  const totalTasksCount = visibleTasks.length;
  const isOpenMode = campaign.mode === 'open';

  // For open mode, get extended labels with colors and geometry types
  const extendedLabels = isOpenMode ? extendLabelsWithMetadata(labels) : [];
  const selectedLabel = isOpenMode
    ? extendedLabels.find((l) => l.id === selectedLabelId) || null
    : null;

  const handleLayerSelect = (index: number) => {
    setSelectedLayerIndex(index);
    setShowBasemap(false);
  };

  const handleBasemapSelect = (type: 'carto-light' | 'esri-world-imagery') => {
    setShowBasemap(true);
    setBasemapType(type);
  };

  // Auto-switch back to imagery layer when window or slice changes
  useEffect(() => {
    if (showBasemap && (activeWindowId || activeSliceIndex !== undefined)) {
      setShowBasemap(false);
    }
  }, [activeWindowId, activeSliceIndex]);

  // Extract coordinates from current task - memoized to prevent unnecessary recalculations
  const latLon = useMemo(
    () => (currentTask ? extractLatLonFromWKT(currentTask.geometry.geometry) : null),
    [currentTask?.geometry.geometry]
  );

  // Determine map center based on mode
  // In open mode, use synchronized map center from store (initialized to campaign bbox center)
  // In task mode, use current task coordinates
  const center = useMemo<[number, number]>(() => {
    if (isOpenMode && currentMapCenter) {
      return currentMapCenter;
    }
    if (latLon) {
      return [latLon.lat, latLon.lon];
    }
    // Fallback to campaign bbox center
    if (campaignBbox) {
      return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    }
    return [0, 0];
  }, [isOpenMode, currentMapCenter, latLon?.lat, latLon?.lon, campaignBbox]);

  // Determine zoom level
  const zoom = useMemo(() => {
    // Use currentMapZoom if available (persists across slice/window changes)
    if (currentMapZoom !== null) {
      return currentMapZoom;
    }
    // Otherwise use default zoom
    return selectedImagery.default_zoom;
  }, [currentMapZoom, selectedImagery.default_zoom]);

  // Callback for when the main map moves
  const handleMapMove = (
    newCenter: [number, number],
    newZoom: number,
    newBounds: [number, number, number, number]
  ) => {
    if (isOpenMode) {
      setMapCenter(newCenter);
      setMapZoom(newZoom);
      setMapBounds(newBounds);
    } else {
      // In task mode, only track zoom (center is determined by task)
      setMapZoom(newZoom);
    }
  };

  // Callback for timeseries tool clicks
  const handleTimeseriesClick = (lat: number, lon: number) => {
    setTimeseriesPoint({ lat, lon });
  };

  // Get the currently active window
  const currentActiveWindowId = activeWindowId ?? selectedImagery.default_main_window_id ?? null;
  const activeWindow = selectedImagery.windows.find((w) => w.id === currentActiveWindowId);

  // Compute slices for the active window
  const slices = useMemo(() => {
    if (!activeWindow) return [];
    return computeTimeSlices(
      activeWindow.window_start_date,
      activeWindow.window_end_date,
      selectedImagery.slicing_interval,
      selectedImagery.slicing_unit
    );
  }, [
    activeWindow?.window_start_date,
    activeWindow?.window_end_date,
    selectedImagery.slicing_interval,
    selectedImagery.slicing_unit,
  ]);

  // Get the currently active slice
  const activeSlice = slices[activeSliceIndex] ?? slices[0];

  // Load STAC imagery for the active window and slice
  const { tileUrls, loading, error } = useStacImagery({
    registrationUrl: selectedImagery.registration_url || '',
    searchBody: selectedImagery.search_body || {},
    bbox: campaignBbox,
    startDate: activeSlice?.startDate || activeWindow?.window_start_date || '',
    endDate: activeSlice?.endDate || activeWindow?.window_end_date || '',
    visualizationUrlTemplates: selectedImagery.visualization_url_templates || [],
    enabled: !!selectedImagery && !!activeWindow,
  });

  // Get the tile URL for the selected layer
  const selectedTileUrl = tileUrls[selectedLayerIndex]?.url || '';

  // Get the current layer name for display
  const currentLayerName = showBasemap
    ? (basemapType === 'esri-world-imagery' ? 'ESRI World Imagery' : 'CartoDB Light')
    : (tileUrls[selectedLayerIndex]?.name || 'Layer');

  return (
    <div className="relative flex-1 bg-neutral-200 text-white text-xs overflow-hidden flex">
      {/* Timeline Sidebar - hidden when basemap is active to avoid confusion*/}
      {!showBasemap && (
        <TimelineSidebar
          imagery={selectedImagery}
          activeWindowId={currentActiveWindowId}
          slices={slices}
          activeSliceIndex={activeSliceIndex}
          collapsed={timelineCollapsed}
          onToggleCollapse={() => setTimelineCollapsed(!timelineCollapsed)}
          onWindowChange={setActiveWindowId}
          onSliceChange={setActiveSliceIndex}
        />
      )}

      {/* Map Viewport */}
      <div
        className="flex-1 flex flex-col relative"
        onMouseEnter={() => setShowLayerDropdown(false)}
      >
        {/* Top controls */}
        <div className="absolute top-2 right-2 z-[1000] flex gap-2">
          {/* Slice Selector - only show if multiple slices */}
          {slices.length > 1 && !showBasemap && (
            <select
              value={activeSliceIndex}
              onChange={(e) => setActiveSliceIndex(Number(e.target.value))}
              className="px-2 py-1.5 bg-white text-neutral-900 text-xs font-medium hover:bg-neutral-100 rounded shadow transition-colors cursor-pointer border border-neutral-300 focus:outline-none appearance-none pr-6 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
              title="Select time slice"
            >
              {slices.map((slice, idx) => (
                <option
                  key={idx}
                  value={idx}
                  className={`
                        ${activeSliceIndex === idx ? 'bg-neutral-100 text-brand-700' : ''}
                        bg-white text-neutral-900
                      `}
                >
                  {slice.label}
                </option>
              ))}
            </select>
          )}

          {/* Layer Selector Dropdown */}
          <div className="relative" onMouseLeave={() => setShowLayerDropdown(false)}>
            <button
              onMouseEnter={() => setShowLayerDropdown(true)}
              className="px-3 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow hover:bg-neutral-50 transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Select layer"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2L2 6L10 10L18 6L10 2Z" />
                <path d="M2 10L10 14L18 10" />
                <path d="M2 14L10 18L18 14" />
              </svg>
              {currentLayerName}
            </button>

            {showLayerDropdown && (
              <div
                className="absolute top-full right-0 bg-white border border-neutral-300 rounded-bl rounded-br shadow-lg min-w-[200px] max-h-[300px] overflow-y-auto z-[1001]"
                onMouseEnter={() => setShowLayerDropdown(true)}
                onMouseLeave={() => setShowLayerDropdown(false)}
              >
                {/* Imagery layers */}
                {tileUrls.map((layer, index) => (
                  <label
                    key={layer.id}
                    className={`flex items-center px-3 py-2 text-sm text-neutral-900 cursor-pointer transition-colors
                      ${selectedLayerIndex === index && !showBasemap ? 'bg-neutral-100 text-brand-700' : ''}
                    `}
                  >
                    <input
                      type="radio"
                      name="layer"
                      checked={selectedLayerIndex === index && !showBasemap}
                      onChange={() => handleLayerSelect(index)}
                      className={`mr-2 accent-brand-500${selectedLayerIndex === index && !showBasemap ? '' : ' hover:accent-brand-500'}`}
                    />
                    <span>{layer.name}</span>
                  </label>
                ))}

                <div className="border-t border-neutral-300 my-1"></div>

                {/* Basemap options */}
                <label
                  className={`flex items-center px-3 py-2 text-sm text-neutral-900 cursor-pointer transition-colors
                    ${showBasemap && basemapType === 'carto-light' ? 'bg-neutral-100 text-brand-700' : ''}
                  `}
                >
                  <input
                    type="radio"
                    name="layer"
                    checked={showBasemap && basemapType === 'carto-light'}
                    onChange={() => handleBasemapSelect('carto-light')}
                    className={`mr-2 accent-brand-500${showBasemap && basemapType === 'carto-light' ? '' : ' hover:accent-brand-500'}`}
                  />
                  <span>CartoDB Light</span>
                </label>

                <label
                  className={`flex items-center px-3 py-2 text-sm text-neutral-900 cursor-pointer transition-colors
                    ${showBasemap && basemapType === 'esri-world-imagery' ? 'bg-neutral-100 text-brand-700' : ''}
                  `}
                >
                  <input
                    type="radio"
                    name="layer"
                    checked={showBasemap && basemapType === 'esri-world-imagery'}
                    onChange={() => handleBasemapSelect('esri-world-imagery')}
                    className={`mr-2 accent-brand-500${showBasemap && basemapType === 'esri-world-imagery' ? '' : ' hover:accent-brand-500'}`}
                  />
                  <span>ESRI World Imagery</span>
                </label>
              </div>
            )}
          </div>

          {/* Refocus Button */}
          <button
            onClick={triggerRefocus}
            className="px-3 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow hover:bg-neutral-50 transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Refocus all maps to center"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 3C10.5523 3 11 3.44772 11 4V5.07089C13.8377 5.50523 16 7.94291 16 10.9V11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H16V13.1C16 16.0571 13.8377 18.4948 11 18.9291V20C11 20.5523 10.5523 21 10 21C9.44772 21 9 20.5523 9 20V18.9291C6.16229 18.4948 4 16.0571 4 13.1V13H3C2.44772 13 2 12.5523 2 12C2 11.4477 2.44772 11 3 11H4V10.9C4 7.94291 6.16229 5.50523 9 5.07089V4C9 3.44772 9.44772 3 10 3ZM10 7C7.79086 7 6 8.79086 6 11V13C6 15.2091 7.79086 17 10 17C12.2091 17 14 15.2091 14 13V11C14 8.79086 12.2091 7 10 7Z" />
            </svg>
          </button>

          {/* Toggle Crosshair Button */}
          <button
            onClick={toggleCrosshair}
            className={`px-3 py-1.5 bg-white text-xs font-medium rounded shadow hover:bg-neutral-50 transition-colors flex items-center gap-1.5 cursor-pointer ${
              showCrosshair ? 'text-neutral-900' : 'text-neutral-400'
            }`}
            title={`${showCrosshair ? 'Hide' : 'Show'} crosshair (O)`}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <circle cx="10" cy="10" r="1.5" />
              <path d="M10 2V6" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M10 14V18" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M2 10H6" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M14 10H18" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
        </div>

        {/* Map content */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-200 text-neutral-900 text-xs z-10">
            Loading imagery...
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 text-red-400 text-xs z-10">
            Error: {error}
          </div>
        )}

        {!loading &&
          !error &&
          selectedImagery &&
          (isOpenMode ? (
            <LeafletMapWithDraw
              center={center}
              zoom={zoom}
              tileUrl={selectedTileUrl}
              crosshairColor={selectedImagery.crosshair_hex6}
              refocusTrigger={refocusTrigger}
              showCrosshair={showCrosshair}
              showBasemap={showBasemap}
              basemapType={basemapType}
              zoomInTrigger={zoomInTrigger}
              zoomOutTrigger={zoomOutTrigger}
              panTrigger={panTrigger}
              selectedLabel={selectedLabel}
              drawingEnabled={activeTool === 'annotate' && !!selectedLabel}
              activeTool={activeTool}
              magicWandActive={
                selectedLabel ? (magicWandEnabled[selectedLabel.id] ?? false) : false
              }
              onMapMove={handleMapMove}
              syncMapState={true}
              onTimeseriesClick={handleTimeseriesClick}
              onAnnotationCreated={() => {
                // Annotation is automatically saved by the map component
              }}
              onAnnotationClicked={(annotationId, label) => {
                // Auto-select the label when clicking an annotation
                setSelectedLabelId(label.id);
              }}
              onAnnotationDeleted={() => {
                // Annotation is automatically deleted by the map component
              }}
            />
          ) : (
            <LeafletMap
              center={center}
              zoom={zoom}
              tileUrl={selectedTileUrl}
              crosshairColor={selectedImagery.crosshair_hex6}
              refocusTrigger={refocusTrigger}
              showCrosshair={showCrosshair}
              showBasemap={showBasemap}
              basemapType={basemapType}
              zoomInTrigger={zoomInTrigger}
              zoomOutTrigger={zoomOutTrigger}
              panTrigger={panTrigger}
              enableTileBuffering={true}
              onMapMove={handleMapMove}
              syncMapState={true}
            />
          ))}

        {!loading && !error && !selectedImagery && (
          <div className="text-neutral-200">[ MAP VIEWPORT - No imagery available ]</div>
        )}
      </div>

      {/* Annotation Controls Panel */}
      <div className="relative h-full">
        {/* Collapse/Expand Button */}
        <button
          onClick={() => setControlsCollapsed(!controlsCollapsed)}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-[1001] w-4 h-10 bg-neutral-200 hover:bg-neutral-300 text-neutral-500 hover:text-neutral-700 rounded-l border border-r-0 border-neutral-300 transition-colors cursor-pointer flex items-center justify-center"
          title={controlsCollapsed ? 'Show annotation controls' : 'Hide annotation controls'}
        >
          <svg
            width="8"
            height="14"
            viewBox="0 0 8 14"
            fill="currentColor"
            className={`transition-transform ${controlsCollapsed ? 'rotate-180' : ''}`}
          >
            <path
              d="M7 1L1 7L7 13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>

        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden border-l border-gray-300 h-full ${
            controlsCollapsed ? 'w-0' : 'w-40'
          }`}
        >
          {!controlsCollapsed &&
            (campaign && campaign.mode == 'tasks' ? (
              <AnnotationControls
                labels={labels}
                onSubmit={submitAnnotation}
                onNext={nextTask}
                onPrevious={previousTask}
                onGoToTask={goToTask}
                isSubmitting={isSubmitting}
                totalTasksCount={totalTasksCount}
                currentTask={currentTask}
                commentInputRef={commentInputRef}
              />
            ) : (
              <OpenModeControls />
            ))}
        </div>
      </div>
    </div>
  );
};

export default MainAnnotationsContainer;
