import { useRef, useMemo } from 'react';
import LeafletMap from './LeafletMap';
import type { ImageryWindowOut } from '~/api/client';
import useAnnotationStore from '../annotation.store';
import { computeTimeSlices, extractLatLonFromWKT } from '~/shared/utils/utility';
import { useStacImagery } from '../hooks/useStacImagery';

interface ImageryContainerProps {
  window: ImageryWindowOut;
}

/**
 * Imagery container component that displays STAC imagery in a map
 */
const ImageryContainer: React.FC<ImageryContainerProps> = ({ window }) => {
  const isDraggingRef = useRef(false);

  // Get state from store
  const campaign = useAnnotationStore((state) => state.campaign);
  const selectedImageryId = useAnnotationStore((state) => state.selectedImageryId);
  const visibleTasks = useAnnotationStore((state) => state.visibleTasks);
  const currentTaskIndex = useAnnotationStore((state) => state.currentTaskIndex);
  const refocusTrigger = useAnnotationStore((state) => state.refocusTrigger);
  const selectedLayerIndex = useAnnotationStore((state) => state.selectedLayerIndex);
  const activeWindowId = useAnnotationStore((state) => state.activeWindowId);
  const activeSliceIndex = useAnnotationStore((state) => state.activeSliceIndex);
  const windowSliceIndices = useAnnotationStore((state) => state.windowSliceIndices);
  const currentMapCenter = useAnnotationStore((state) => state.currentMapCenter);
  const currentMapZoom = useAnnotationStore((state) => state.currentMapZoom);
  const setActiveWindowId = useAnnotationStore((state) => state.setActiveWindowId);
  const setActiveSliceIndex = useAnnotationStore((state) => state.setActiveSliceIndex);

  // Compute derived values
  const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId) || null;
  const currentTask = visibleTasks[currentTaskIndex] || null;
  const isOpenMode = campaign?.mode === 'open';
  const campaignBbox = campaign
    ? ([
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
      ] as [number, number, number, number])
    : null;

  // Determine if this window is the active window
  const isActiveWindow =
    selectedImagery && window.id === (activeWindowId ?? selectedImagery.default_main_window_id);

  // Compute slices for this window
  const slices = useMemo(() => {
    if (!selectedImagery) return [];
    return computeTimeSlices(
      window.window_start_date,
      window.window_end_date,
      selectedImagery.slicing_interval,
      selectedImagery.slicing_unit
    );
  }, [
    window.window_start_date,
    window.window_end_date,
    selectedImagery?.slicing_interval,
    selectedImagery?.slicing_unit,
  ]);

  // Use global slice index for active window, stored index for others
  const currentSliceIndex = isActiveWindow
    ? activeSliceIndex
    : (windowSliceIndices[window.id] ?? 0);
  const activeSlice = slices[currentSliceIndex] ?? slices[0];

  if (!selectedImagery || !campaignBbox) return null;

  // Memoize latLon extraction to prevent recalculations
  const latLon = useMemo(
    () => (currentTask ? extractLatLonFromWKT(currentTask.geometry.geometry) : null),
    [currentTask?.geometry.geometry]
  );

  // Determine center based on mode
  // In open mode, use synchronized map center from store
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
  // In both open mode and task mode, use the synchronized zoom from the store
  // so that zooming on the main map also zooms the small imagery containers
  const zoom = useMemo(() => {
    if (currentMapZoom !== null) {
      return currentMapZoom;
    }
    return selectedImagery.default_zoom;
  }, [currentMapZoom, selectedImagery.default_zoom]);

  const { tileUrls, loading, error } = useStacImagery({
    registrationUrl: selectedImagery.registration_url,
    searchBody: selectedImagery.search_body,
    bbox: campaignBbox,
    startDate: activeSlice?.startDate || window.window_start_date,
    endDate: activeSlice?.endDate || window.window_end_date,
    visualizationUrlTemplates: selectedImagery.visualization_url_templates,
    enabled: true,
  });

  // Use the selected layer index or fallback to first tile URL
  const tileUrl = tileUrls.length > selectedLayerIndex ? tileUrls[selectedLayerIndex].url : '';

  // Handle click - only trigger if not dragging
  const handleMouseDown = () => {
    isDraggingRef.current = false;
  };

  const handleMouseMove = () => {
    isDraggingRef.current = true;
  };

  const handleMouseUp = () => {
    if (!isDraggingRef.current) {
      setActiveWindowId(window.id);
    }
    isDraggingRef.current = false;
  };

  const handleSliceChange = (index: number) => {
    if (isActiveWindow) {
      // Active window uses the global slice index
      setActiveSliceIndex(index);
    } else {
      // Non-active windows update their stored slice index
      useAnnotationStore.getState().setWindowSliceIndex(window.id, index);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white text-slate-400 text-[10px]">
        Loading imagery...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white text-red-400 text-[10px]">
        Error: {error}
      </div>
    );
  }

  if (!tileUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white text-slate-400 text-[10px]">
        No imagery available
      </div>
    );
  }

  return (
    <div
      className="flex-1 relative"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Slice selector - only show if multiple slices */}
      {slices.length > 1 && (
        <div className="absolute bottom-1 right-1 z-[1000]">
          <select
            value={currentSliceIndex}
            onChange={(e) => handleSliceChange(Number(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-[9px] px-1 py-0.5 bg-white/90 border border-neutral-300 rounded text-neutral-900 cursor-pointer hover:bg-white"
            title="Select time slice"
          >
            {slices.map((slice, idx) => (
              <option key={idx} value={idx}>
                {slice.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <LeafletMap
        center={center}
        zoom={zoom}
        tileUrl={tileUrl}
        crosshairColor={selectedImagery.crosshair_hex6}
        refocusTrigger={refocusTrigger}
        disableKeyboard={true}
        syncMapState={true}
        showCrosshair={!isOpenMode}
      />
    </div>
  );
};

export default ImageryContainer;
