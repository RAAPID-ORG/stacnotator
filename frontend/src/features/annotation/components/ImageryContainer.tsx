import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
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
  const markSliceEmpty = useAnnotationStore((state) => state.markSliceEmpty);
  const emptySlices = useAnnotationStore((state) => state.emptySlices);

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
    !!selectedImagery && window.id === (activeWindowId ?? selectedImagery.default_main_window_id);

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

  // Resolve tile URL from pre-registered SliceLayerMap
  const { sliceLayerMap } = useSliceLayerMap();
  const sliceKey = `${window.id}-${currentSliceIndex}`;
  const resolvedUrls = sliceLayerMap.get(sliceKey);
  const tileUrl = resolvedUrls?.[selectedLayerIndex]?.url ?? resolvedUrls?.[0]?.url ?? '';
  const loading = !resolvedUrls;
  const datesReady = !loading;

  // Memoize latLon extraction to prevent recalculations
  const latLon = useMemo(
    () => (currentTask ? extractLatLonFromWKT(currentTask.geometry.geometry) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when geometry changes
    [currentTask?.geometry.geometry]
  );

  // Initial center for map mount - task location or bbox center, computed once
  const initialCenter = useMemo<[number, number]>(() => {
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox) return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return [0, 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reactive center - always follows the main map so panning syncs in both modes
  const center = useMemo<[number, number] | undefined>(() => {
    if (currentMapCenter) return currentMapCenter;
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox) return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMapCenter, latLon?.lat, latLon?.lon]);

  // Determine zoom level
  const zoom = useMemo(() => {
    if (currentMapZoom !== null) return currentMapZoom;
    return selectedImagery?.default_zoom ?? 10;
  }, [currentMapZoom, selectedImagery?.default_zoom]);

  // Crosshair at task location
  const crosshair = !isOpenMode && latLon
    ? { lat: latLon.lat, lon: latLon.lon, color: selectedImagery?.crosshair_hex6 ?? undefined }
    : undefined;

  // True once every slice for this window has been confirmed empty.
  // Only relevant in task mode - in open mode we always show the map.
  const allSlicesEmpty = !isOpenMode && slices.length > 0 && slices.every((_, i) => emptySlices[`${window.id}-${i}`]);

  // Empty-tile alert state - reset whenever the tileUrl changes
  const [emptyTileAlert, setEmptyTileAlert] = useState<string | null>(null);
  useEffect(() => { setEmptyTileAlert(null); }, [tileUrl]);

  // Stable ref so the OL tile-error callback always reads current values
  // without needing to be recreated whenever deps change.
  const emptyTilesStateRef = useRef({
    window,
    activeSlice,
    sliceKey,
    isActiveWindow,
    slices,
    currentSliceIndex,
    emptySlices,
    markSliceEmpty,
    setActiveSliceIndex,
    setWindowSliceIndex: useAnnotationStore.getState().setWindowSliceIndex,
    setEmptyTileAlert,
  });
  // Keep ref in sync every render so the callback always sees fresh values
  emptyTilesStateRef.current = {
    window,
    activeSlice,
    sliceKey,
    isActiveWindow,
    slices,
    currentSliceIndex,
    emptySlices,
    markSliceEmpty,
    setActiveSliceIndex,
    setWindowSliceIndex: useAnnotationStore.getState().setWindowSliceIndex,
    setEmptyTileAlert,
  };

  // Stable callback passed to WindowMap - never recreated, always reads ref
  // In open mode this is omitted: empty-tile detection is based on where we
  // scrolled to and would incorrectly hide valid imagery elsewhere.
  const handleEmptyTiles = useCallback(() => {
    if (isOpenMode) return; // never fire in open mode
    const {
      window: win,
      activeSlice: slice,
      sliceKey: key,
      isActiveWindow: isActive,
      slices: allSlices,
      currentSliceIndex: curIdx,
      emptySlices: empty,
      markSliceEmpty: mark,
      setActiveSliceIndex: setActive,
      setWindowSliceIndex: setStored,
      setEmptyTileAlert: setAlert,
    } = emptyTilesStateRef.current;

    const windowLabel = `Window ${win.window_index + 1}`;
    const sliceLabel = slice?.label ?? '';
    const alertLabel = sliceLabel ? `${windowLabel} - ${sliceLabel}` : windowLabel;

    // Persist into store so keyboard nav and timeline can skip this slice
    mark(key);

    // Auto-advance to the next non-empty slice
    const nextIndex = allSlices.findIndex(
      (_, i) => i !== curIdx && !empty[`${win.id}-${i}`]
    );

    if (nextIndex !== -1) {
      if (isActive) {
        setActive(nextIndex);
      } else {
        setStored(win.id, nextIndex);
      }
      // Don't show alert - we silently skipped it
      return;
    }

    // All slices are empty - show the alert
    setAlert(alertLabel);
  }, []); // stable - all state read from ref

  // Early return AFTER all hooks
  if (!selectedImagery || !campaignBbox) return null;

  // Handle click - only trigger if not dragging (makes the window "active")
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
      {/* Slice selector - empty slices are hidden */}
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
            {slices.map((slice, idx) => {
              const key = `${window.id}-${idx}`;
              // In open mode show all slices; in task mode hide confirmed-empty ones
              if (!isOpenMode && emptySlices[key]) return null;
              return <option key={idx} value={idx}>{slice.label}</option>;
            })}
          </select>
        </div>
      )}

      {/* Status overlays */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100/80 z-[999] text-neutral-500 text-[10px] pointer-events-none">
          Loading…
        </div>
      )}

      {/* All-slices-empty: full-panel message replaces the map */}
      {allSlicesEmpty ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-neutral-100 text-neutral-500 select-none">
          <svg className="w-6 h-6 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M2.25 15.75 7.5 10.5l4.5 4.5 3-3 4.5 4.5M3.75 19.5h16.5M3.75 4.5h16.5" />
          </svg>
          <span className="text-[10px] font-medium text-neutral-400 text-center px-2 leading-snug">
            No imagery available
          </span>
        </div>
      ) : (
        <>
          {/* Partial-empty alert - shown only when some (not all) slices are empty and we couldn't auto-advance */}
          {emptyTileAlert && (
            <div className="absolute top-1 left-1 right-1 z-[1001] flex items-start gap-1 bg-amber-50 border border-amber-400 rounded px-2 py-1 text-[10px] text-amber-800 shadow-sm">
              <span className="flex-1">
                No imagery data for <strong>{emptyTileAlert}</strong>
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setEmptyTileAlert(null); }}
                onMouseDown={(e) => e.stopPropagation()}
                className="ml-1 text-amber-600 hover:text-amber-900 font-bold leading-none"
                title="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {datesReady && (tileUrl || isOpenMode) ? (
            <WindowMap
              initialCenter={initialCenter}
              initialZoom={zoom}
              center={center}
              zoom={zoom}
              tileUrl={tileUrl}
              crosshair={crosshair}
              showCrosshair={!isOpenMode}
              refocusTrigger={refocusTrigger}
              detectionKey={currentTaskIndex}
              onEmptyTiles={handleEmptyTiles}
            />
          ) : (
            !loading && (
              <div className="w-full h-full flex items-center justify-center bg-neutral-100 text-neutral-400 text-[10px]">
                No imagery available
              </div>
            )
          )}
        </>
      )}
    </div>
  );
};

export default ImageryContainer;
