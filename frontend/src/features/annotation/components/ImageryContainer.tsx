import { useRef, useMemo } from 'react';
import WindowMap from './Map/WindowMap';
import type { ImageryWindowOut } from '~/api/client';
import useAnnotationStore from '../annotation.store';
import { computeTimeSlices, extractLatLonFromWKT } from '~/shared/utils/utility';
import { useSliceLayerMap } from '../context/SliceLayerMapContext';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- using ?.property for precise dependency tracking
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

  // Memoize latLon extraction to prevent recalculations
  const latLon = useMemo(
    () => (currentTask ? extractLatLonFromWKT(currentTask.geometry.geometry) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when geometry changes
    [currentTask?.geometry.geometry]
  );

  // Initial center for map mount — task location or bbox center, computed once
  const initialCenter = useMemo<[number, number]>(() => {
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox) return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return [0, 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reactive center — always follows the main map so panning syncs in both modes
  const center = useMemo<[number, number] | undefined>(() => {
    if (currentMapCenter) return currentMapCenter;
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox) return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMapCenter, latLon?.lat, latLon?.lon]);

  // Determine zoom level
  // In both open mode and task mode, use the synchronized zoom from the store
  // so that zooming on the main map also zooms the small imagery containers
  const zoom = useMemo(() => {
    if (currentMapZoom !== null) {
      return currentMapZoom;
    }
    return selectedImagery?.default_zoom ?? 10;
  }, [currentMapZoom, selectedImagery?.default_zoom]);

  if (!selectedImagery || !campaignBbox) return null;

  // ── Resolve tile URL from pre-registered SliceLayerMap ──────────────────
  // The AnnotationPage pre-registers all slices before showing the Canvas, so
  // this lookup always succeeds for slice-0 on first render. Later slices fill
  // in as the background registration continues.
  const { sliceLayerMap } = useSliceLayerMap();
  const sliceKey = `${window.id}-${currentSliceIndex}`;
  const resolvedUrls = sliceLayerMap.get(sliceKey);
  // Pick the viz template matching the selected layer index
  const tileUrl = resolvedUrls?.[selectedLayerIndex]?.url ?? resolvedUrls?.[0]?.url ?? '';
  const loading = !resolvedUrls;
  const datesReady = !loading;

  // Crosshair at task location — same logic as main map
  const crosshair = !isOpenMode && latLon
    ? { lat: latLon.lat, lon: latLon.lon, color: selectedImagery.crosshair_hex6 ?? undefined }
    : undefined;

  // Handle click — only trigger if not dragging (makes the window "active")
  const handleMouseDown = () => { isDraggingRef.current = false; };
  const handleMouseMove = () => { isDraggingRef.current = true; };
  const handleMouseUp = () => {
    if (!isDraggingRef.current) setActiveWindowId(window.id);
    isDraggingRef.current = false;
  };

  const handleSliceChange = (index: number) => {
    if (isActiveWindow) {
      setActiveSliceIndex(index);
    } else {
      useAnnotationStore.getState().setWindowSliceIndex(window.id, index);
    }
  };

  return (
    <div
      className="flex-1 relative overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Slice selector */}
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
              <option key={idx} value={idx}>{slice.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Status overlays */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100/80 z-[999] text-neutral-500 text-[10px] pointer-events-none">
          Loading…
        </div>
      )}

      {datesReady && tileUrl ? (
        <WindowMap
          initialCenter={initialCenter}
          initialZoom={zoom}
          center={center}
          zoom={zoom}
          tileUrl={tileUrl}
          crosshair={crosshair}
          showCrosshair={!isOpenMode}
          refocusTrigger={refocusTrigger}
        />
      ) : (
        !loading && (
          <div className="w-full h-full flex items-center justify-center bg-neutral-100 text-neutral-400 text-[10px]">
            No imagery available
          </div>
        )
      )}
    </div>
  );
};

export default ImageryContainer;
