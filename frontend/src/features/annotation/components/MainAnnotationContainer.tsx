import { useMemo, useState, useCallback, useRef, memo } from 'react';
import TaskModeMap from './Map/TaskModeMap';
import OpenModeMap from './Map/OpenModeMap';
import type { OpenModeMapHandle } from './Map/OpenModeMap';
import TimelineSidebar from './TimelineSidebar';
import LayerSelector from './Map/LayerSelector';
import type { Layer } from './Map/LayerSelector';
import useAnnotationStore from '../annotation.store';
import {
  computeTimeSlices,
  extractLatLonFromWKT,
  formatWindowLabel,
} from '~/shared/utils/utility';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { useStacRegistration } from '../hooks/useStacRegistration';
import { extendLabelsWithMetadata } from './ControlsOpenMode';

interface MainAnnotationsContainerProps {
  commentInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Main annotation container
 * Coordinates map display, timeline, and annotation controls
 */
export const MainAnnotationsContainer = ({ commentInputRef: _commentInputRef }: MainAnnotationsContainerProps) => {
  const campaign = useAnnotationStore((state) => state.campaign);
  const selectedImageryId = useAnnotationStore((state) => state.selectedImageryId);
  const visibleTasks = useAnnotationStore((state) => state.visibleTasks);
  const currentTaskIndex = useAnnotationStore((state) => state.currentTaskIndex);
  const activeWindowId = useAnnotationStore((state) => state.activeWindowId);
  const activeSliceIndex = useAnnotationStore((state) => state.activeSliceIndex);
  const showCrosshair = useAnnotationStore((state) => state.showCrosshair);
  const activeTool = useAnnotationStore((state) => state.activeTool);
  const refocusTrigger = useAnnotationStore((state) => state.refocusTrigger);
  const setActiveWindowId = useAnnotationStore((state) => state.setActiveWindowId);
  const setActiveSliceIndex = useAnnotationStore((state) => state.setActiveSliceIndex);
  const toggleCrosshair = useAnnotationStore((state) => state.toggleCrosshair);
  const triggerRefocus = useAnnotationStore((state) => state.triggerRefocus);
  const setActiveTool = useAnnotationStore((state) => state.setActiveTool);
  const setMapCenter = useAnnotationStore((state) => state.setMapCenter);
  const setMapZoom = useAnnotationStore((state) => state.setMapZoom);
  const setSelectedLayerIndex = useAnnotationStore((state) => state.setSelectedLayerIndex);
  const setShowBasemap = useAnnotationStore((state) => state.setShowBasemap);
  const setBasemapType = useAnnotationStore((state) => state.setBasemapType);
  const emptySlices = useAnnotationStore((state) => state.emptySlices);
  const setTimeseriesPoint = useAnnotationStore((state) => state.setTimeseriesPoint);
  const setProbeTimeseriesPoint = useAnnotationStore((state) => state.setProbeTimeseriesPoint);
  const probeTimeseriesPoint = useAnnotationStore((state) => state.probeTimeseriesPoint);
  const timeseriesPoint = useAnnotationStore((state) => state.timeseriesPoint);

  // Open-mode annotation state
  const selectedLabelId = useAnnotationStore((state) => state.selectedLabelId);
  const magicWandEnabled = useAnnotationStore((state) => state.magicWandEnabled);

  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const [mapLayers, setMapLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string>('');

  const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId) ?? null;
  const currentTask = visibleTasks[currentTaskIndex] ?? null;

  const campaignBbox = useMemo(
    () => campaign
      ? ([
          campaign.settings.bbox_west,
          campaign.settings.bbox_south,
          campaign.settings.bbox_east,
          campaign.settings.bbox_north,
        ] as [number, number, number, number])
      : ([0, 0, 0, 0] as [number, number, number, number]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      campaign?.settings.bbox_west,
      campaign?.settings.bbox_south,
      campaign?.settings.bbox_east,
      campaign?.settings.bbox_north,
    ]
  );

  // STAC registration - register all slices in parallel, concurrency-limited
  const { sliceLayerMap, allRegistered } = useStacRegistration({
    imagery: selectedImagery,
    bbox: campaignBbox,
    enabled: !!selectedImagery,
  });

  const openModeMapRef = useRef<OpenModeMapHandle>(null);

  // Resolve the active window
  const currentActiveWindowId = activeWindowId ?? selectedImagery?.default_main_window_id ?? null;
  const activeWindow = selectedImagery?.windows.find((w) => w.id === currentActiveWindowId);

  // Compute slices for the active window (for TimelineSidebar)
  const slices = useMemo(() => {
    if (!activeWindow || !selectedImagery) return [];
    return computeTimeSlices(
      activeWindow.window_start_date,
      activeWindow.window_end_date,
      selectedImagery.slicing_interval,
      selectedImagery.slicing_unit
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeWindow?.window_start_date,
    activeWindow?.window_end_date,
    selectedImagery?.slicing_interval,
    selectedImagery?.slicing_unit,
  ]);

  // Initial center: task geometry -> bbox center. Never updated by live map movement.
  const latLon = useMemo(
    () => (currentTask ? extractLatLonFromWKT(currentTask.geometry.geometry) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTask?.geometry.geometry]
  );

  const initialCenter = useMemo<[number, number]>(() => {
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox) return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return [0, 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // computed once on mount

  // In task mode, pan to the task center whenever the task changes
  const center = useMemo<[number, number] | undefined>(() => {
    if (campaign?.mode !== 'tasks' || !latLon) return undefined;
    return [latLon.lat, latLon.lon];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latLon?.lat, latLon?.lon, campaign?.mode]);

  // In task mode, show a crosshair at the task location
  const crosshair = useMemo(() => {
    if (campaign?.mode !== 'tasks' || !latLon) return undefined;
    return { lat: latLon.lat, lon: latLon.lon };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latLon?.lat, latLon?.lon, campaign?.mode]);

  const initialZoom = selectedImagery?.default_zoom ?? 10;

  // Open mode: derive the selected label and magic wand state
  const extendedLabels = useMemo(
    () => extendLabelsWithMetadata(campaign?.settings.labels ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign?.settings.labels],
  );
  const selectedLabel = extendedLabels.find((l) => l.id === selectedLabelId) ?? null;
  const magicWandActive = selectedLabelId != null && (magicWandEnabled[selectedLabelId] ?? false);

  // Stable callback - must be declared before early return (hook rules)
  const handleTimeseriesClick = useCallback((lat: number, lon: number) => {
    if (campaign?.mode === 'tasks') {
      setProbeTimeseriesPoint({ lat, lon });
    } else {
      setTimeseriesPoint({ lat, lon });
    }
  }, [campaign?.mode, setTimeseriesPoint, setProbeTimeseriesPoint]);

  if (!campaign || !selectedImagery) return null;

  const isTaskMode = campaign.mode === 'tasks';
  const isOpenMode = campaign.mode === 'open';

  return (
    <div className="flex h-full w-full">
      <TimelineSidebar
        imagery={selectedImagery}
        activeWindowId={activeWindowId ?? selectedImagery.default_main_window_id ?? null}
        slices={slices}
        activeSliceIndex={activeSliceIndex}
        collapsed={timelineCollapsed}
        onToggleCollapse={() => setTimelineCollapsed((c) => !c)}
        onWindowChange={setActiveWindowId}
        onSliceChange={setActiveSliceIndex}
        onDraggingChange={setTimelineDragging}
        emptySlices={emptySlices}
      />
      <div className="flex-1 min-w-0 h-full relative">

        {/* Top-right controls for task mode */}
        {isTaskMode && (
          <div className="absolute top-2 right-2 z-[1000] flex gap-2 items-center" data-tour="map-controls">

            {/* Layer selector */}
            {mapLayers.length > 0 && (
              <LayerSelector
                layers={mapLayers}
                selectedLayer={mapLayers.find((l) => l.id === activeLayerId)}
                onLayerSelect={(layerId) => {
                  setActiveLayerId(layerId);
                  const layer = mapLayers.find((l) => l.id === layerId);
                  if (layer?.layerType === 'basemap') {
                    setBasemapType(layer.id as Parameters<typeof setBasemapType>[0]);
                    setShowBasemap(true);
                  } else {
                    const match = layerId.match(/-v(\d+)$/);
                    if (match) {
                      const templateId = Number(match[1]);
                      const idx = (selectedImagery.visualization_url_templates ?? [])
                        .findIndex((t) => t.id === templateId);
                      if (idx !== -1) setSelectedLayerIndex(idx);
                    }
                  }
                }}
              />
            )}

            {/* Window selector */}
            {selectedImagery.windows.length > 1 && (
              <select
                value={currentActiveWindowId ?? ''}
                onChange={(e) => setActiveWindowId(Number(e.target.value))}
                className="px-2 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-6 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
                title="Select window"
              >
                {selectedImagery.windows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {formatWindowLabel(w.window_start_date, w.window_end_date, selectedImagery.window_unit)}
                  </option>
                ))}
              </select>
            )}

            {/* Slice selector */}
            {slices.length > 1 && (
              <select
                value={activeSliceIndex}
                onChange={(e) => setActiveSliceIndex(Number(e.target.value))}
                className="px-2 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-6 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
                title="Select time slice"
              >
                {slices.map((slice, idx) => {
                  const isEmpty = !!emptySlices[`${currentActiveWindowId}-${idx}`];
                  return (
                    <option key={idx} value={idx} disabled={isEmpty} style={isEmpty ? { color: '#aaa' } : undefined}>
                      {slice.label}{isEmpty ? ' (empty)' : ''}
                    </option>
                  );
                })}
              </select>
            )}

            {/* Recenter button */}
            <button
              onClick={triggerRefocus}
              className="px-2 py-1.5 bg-white text-neutral-900 rounded shadow hover:bg-neutral-50 transition-colors flex items-center cursor-pointer"
              title="Recenter map"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 3C10.5523 3 11 3.44772 11 4V5.07089C13.8377 5.50523 16 7.94291 16 10.9V11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H16V13.1C16 16.0571 13.8377 18.4948 11 18.9291V20C11 20.5523 10.5523 21 10 21C9.44772 21 9 20.5523 9 20V18.9291C6.16229 18.4948 4 16.0571 4 13.1V13H3C2.44772 13 2 12.5523 2 12C2 11.4477 2.44772 11 3 11H4V10.9C4 7.94291 6.16229 5.50523 9 5.07089V4C9 3.44772 9.44772 3 10 3ZM10 7C7.79086 7 6 8.79086 6 11V13C6 15.2091 7.79086 17 10 17C12.2091 17 14 15.2091 14 13V11C14 8.79086 12.2091 7 10 7Z" />
              </svg>
            </button>

            {/* Crosshair toggle */}
            <button
              onClick={toggleCrosshair}
              className={`px-2 py-1.5 bg-white rounded shadow hover:bg-neutral-50 transition-colors flex items-center cursor-pointer ${showCrosshair ? 'text-neutral-900' : 'text-neutral-400'}`}
              title={showCrosshair ? 'Hide crosshair' : 'Show crosshair'}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <circle cx="10" cy="10" r="1.5" />
                <path d="M10 2V6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M10 14V18" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M2 10H6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M14 10H18" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>

            {/* Timeseries probe tool */}
            {campaign.time_series.length > 0 && (
              <button
                onClick={() => setActiveTool(activeTool === 'timeseries' ? 'pan' : 'timeseries')}
                className={`px-2 py-1.5 rounded shadow transition-colors flex items-center cursor-pointer ${activeTool === 'timeseries' ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-white text-neutral-900 hover:bg-neutral-50'}`}
                title={activeTool === 'timeseries' ? 'Deactivate timeseries probe' : 'Activate timeseries probe'}
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="2,16 5,10 8,12 11,6 14,9 17,3" strokeLinejoin="round" strokeLinecap="round" />
                  <circle cx="14" cy="14" r="4" fill="none" />
                  <line x1="17" y1="17" x2="19" y2="19" />
                </svg>
              </button>
            )}
          </div>
        )}

        {isOpenMode && (
          <div className="absolute top-2 right-2 z-[1000] flex gap-2 items-center">
            <button
              onClick={() => openModeMapRef.current?.fitAnnotations()}
              className="px-2 py-1.5 bg-white text-neutral-900 rounded shadow hover:bg-neutral-50 transition-colors flex items-center cursor-pointer"
              title="Fit view to all annotations (Space)"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="14" height="14" rx="1" />
                <path d="M3 7h14M3 13h14M7 3v14M13 3v14" strokeWidth="1" opacity="0.4"/>
                <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none"/>
              </svg>
            </button>
          </div>
        )}

        {/* Map - task mode uses TaskModeMap; open mode uses OpenModeMap with drawing */}
        {isTaskMode ? (
          <TaskModeMap
            imagery={selectedImagery}
            sliceLayerMap={sliceLayerMap}
            initialCenter={initialCenter}
            initialZoom={initialZoom}
            center={center}
            refocusTrigger={refocusTrigger}
            crosshair={crosshair}
            showCrosshair={showCrosshair}
            activeLayerId={activeLayerId}
            onLayersChange={(layers, id) => { setMapLayers(layers); setActiveLayerId(id); }}
            onViewChange={(newCenter, zoom) => { setMapCenter(newCenter); setMapZoom(zoom); }}
            activeTool={activeTool}
            onTimeseriesClick={handleTimeseriesClick}
            probePoint={probeTimeseriesPoint}
          />
        ) : (
          <OpenModeMap
            ref={openModeMapRef}
            imagery={selectedImagery}
            sliceLayerMap={sliceLayerMap}
            initialCenter={initialCenter}
            initialZoom={initialZoom}
            refocusTrigger={refocusTrigger}
            onViewChange={(newCenter, zoom) => { setMapCenter(newCenter); setMapZoom(zoom); }}
            selectedLabel={selectedLabel}
            activeTool={activeTool}
            magicWandActive={magicWandActive}
            onTimeseriesClick={handleTimeseriesClick}
            probePoint={timeseriesPoint}
          />
        )}

        {/* Loading overlay - shown until STAC registrations complete */}
        {!allRegistered && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 px-8 py-6 bg-white rounded-2xl border border-neutral-200 shadow-2xl">
              <LoadingSpinner
                size="lg"
                text="Loading imagery…"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(MainAnnotationsContainer);
