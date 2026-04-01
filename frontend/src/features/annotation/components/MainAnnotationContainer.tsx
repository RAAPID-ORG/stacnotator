import { useMemo, useState, useCallback, useRef, memo } from 'react';
import TaskModeMap from './Map/TaskModeMap';
import OpenModeMap from './Map/OpenModeMap';
import type { OpenModeMapHandle } from './Map/OpenModeMap';
import TimelineSidebar from './TimelineSidebar';
import LayerSelector from './Map/LayerSelector';
import type { Layer } from './Map/LayerSelector';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import {
  extractCentroidFromWKT,
  computeExtentGeoJSON,
  convertWKTToGeoJSON,
} from '~/shared/utils/utility';
import { extendLabelsWithMetadata } from './ControlsOpenMode';

interface MainAnnotationsContainerProps {
  commentInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export const MainAnnotationsContainer = ({
  commentInputRef: _commentInputRef,
}: MainAnnotationsContainerProps) => {
  const campaign = useCampaignStore((s) => s.campaign);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);

  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);
  const selectedLabelId = useTaskStore((s) => s.selectedLabelId);
  const magicWandEnabled = useTaskStore((s) => s.magicWandEnabled);

  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const showCrosshair = useMapStore((s) => s.showCrosshair);
  const activeTool = useMapStore((s) => s.activeTool);
  const refocusTrigger = useMapStore((s) => s.refocusTrigger);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);
  const setActiveSliceIndex = useMapStore((s) => s.setActiveSliceIndex);
  const toggleCrosshair = useMapStore((s) => s.toggleCrosshair);
  const triggerRefocus = useMapStore((s) => s.triggerRefocus);
  const setActiveTool = useMapStore((s) => s.setActiveTool);
  const setMapCenter = useMapStore((s) => s.setMapCenter);
  const setMapZoom = useMapStore((s) => s.setMapZoom);
  const setMapBounds = useMapStore((s) => s.setMapBounds);
  const setSelectedLayerIndex = useMapStore((s) => s.setSelectedLayerIndex);
  const setShowBasemap = useMapStore((s) => s.setShowBasemap);
  const setSelectedBasemapId = useMapStore((s) => s.setSelectedBasemapId);
  const emptySlices = useMapStore((s) => s.emptySlices);
  const setTimeseriesPoint = useMapStore((s) => s.setTimeseriesPoint);
  const setProbeTimeseriesPoint = useMapStore((s) => s.setProbeTimeseriesPoint);
  const probeTimeseriesPoint = useMapStore((s) => s.probeTimeseriesPoint);
  const timeseriesPoint = useMapStore((s) => s.timeseriesPoint);
  const viewSyncEnabled = useMapStore((s) => s.viewSyncEnabled);
  const toggleViewSync = useMapStore((s) => s.toggleViewSync);

  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [_timelineDragging, setTimelineDragging] = useState(false);
  const [mapLayers, setMapLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string>('');

  const selectedView = campaign?.imagery_views?.find((v) => v.id === selectedViewId) ?? null;
  const currentTask = visibleTasks[currentTaskIndex] ?? null;

  // Resolve the active collection and its source
  const activeCollection = useMemo(() => {
    if (!campaign || !activeCollectionId) return null;
    for (const src of campaign.imagery_sources) {
      const col = src.collections.find((c) => c.id === activeCollectionId);
      if (col) return col;
    }
    return null;
  }, [campaign, activeCollectionId]);

  const activeSource = useMemo(() => {
    if (!campaign || !activeCollectionId) return null;
    for (const src of campaign.imagery_sources) {
      if (src.collections.some((c) => c.id === activeCollectionId)) return src;
    }
    return null;
  }, [campaign, activeCollectionId]);

  // Get all collections referenced in the current view
  const viewCollections = useMemo(() => {
    if (!campaign || !selectedView) return [];
    return selectedView.collection_refs
      .map((ref) => {
        const source = campaign.imagery_sources.find((s) => s.id === ref.source_id);
        const collection = source?.collections.find((c) => c.id === ref.collection_id);
        return { ...ref, collection, source };
      })
      .filter((r) => r.collection && r.source);
  }, [campaign, selectedView]);

  const campaignBbox = useMemo(
    () =>
      campaign
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

  const openModeMapRef = useRef<OpenModeMapHandle>(null);

  // Slices from the active collection
  const slices = activeCollection?.slices ?? [];

  // Initial center
  const latLon = useMemo(
    () => (currentTask ? extractCentroidFromWKT(currentTask.geometry.geometry) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTask?.geometry.geometry]
  );

  const initialCenter = useMemo<[number, number]>(() => {
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox)
      return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return [0, 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center = useMemo<[number, number] | undefined>(() => {
    if (campaign?.mode !== 'tasks' || !latLon) return undefined;
    return [latLon.lat, latLon.lon];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latLon?.lat, latLon?.lon, campaign?.mode]);

  // Detect whether the current task has a polygon geometry (uploaded from GeoJSON)
  const isPolygonTask = useMemo(() => {
    if (!currentTask) return false;
    const geojson = convertWKTToGeoJSON(currentTask.geometry.geometry);
    return !!geojson && (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTask?.geometry.geometry]);

  const crosshair = useMemo(() => {
    if (campaign?.mode !== 'tasks' || !latLon || isPolygonTask) return undefined;
    return { lat: latLon.lat, lon: latLon.lon, color: activeSource?.crosshair_hex6 ?? undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latLon?.lat, latLon?.lon, campaign?.mode, activeSource?.crosshair_hex6, isPolygonTask]);

  // Compute sample extent GeoJSON for the current task
  const sampleExtent = useMemo<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>(() => {
    if (campaign?.mode !== 'tasks' || !currentTask) return null;
    const wkt = currentTask.geometry.geometry;
    const geojson = convertWKTToGeoJSON(wkt);
    // If the task geometry is already a polygon/multipolygon, use it directly
    if (geojson && (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon'))
      return geojson as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    // If it's a point with sample_extent_meters, compute a square extent
    if (latLon && campaign.settings.sample_extent_meters) {
      return computeExtentGeoJSON(latLon.lat, latLon.lon, campaign.settings.sample_extent_meters);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentTask?.geometry.geometry,
    campaign?.mode,
    campaign?.settings.sample_extent_meters,
    latLon?.lat,
    latLon?.lon,
  ]);

  const initialZoom = activeSource?.default_zoom ?? 10;

  // Open mode labels
  const extendedLabels = useMemo(
    () => extendLabelsWithMetadata(campaign?.settings.labels ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign?.settings.labels]
  );
  const selectedLabel = extendedLabels.find((l) => l.id === selectedLabelId) ?? null;
  const magicWandActive = selectedLabelId != null && (magicWandEnabled[selectedLabelId] ?? false);

  // Flat viz entries mirroring the store's selectedLayerIndex ordering
  const allVizEntries = useMemo(
    () =>
      (campaign?.imagery_sources ?? []).flatMap((src) =>
        src.visualizations.map((v) => ({ sourceName: src.name, vizName: v.name }))
      ),
    [campaign?.imagery_sources]
  );

  /** Handle layer selection from LayerSelector dropdown */
  const handleLayerSelect = useCallback(
    (layerId: string) => {
      setActiveLayerId(layerId);
      const layer = mapLayers.find((l) => l.id === layerId);
      if (layer?.layerType === 'basemap') {
        setSelectedBasemapId(layer.id);
        setShowBasemap(true);
      } else {
        // Extract viz name from layer id: tile-c{id}-s{idx}-v{vizName}
        const vIdx = layerId.indexOf('-v');
        if (vIdx !== -1) {
          const vizName = layerId.slice(vIdx + 2);
          const entryIdx = allVizEntries.findIndex((e) => e.vizName === vizName);
          if (entryIdx !== -1) {
            setSelectedLayerIndex(entryIdx); // also sets showBasemap=false
          }
        }
      }
    },
    [
      mapLayers,
      allVizEntries,
      setActiveLayerId,
      setSelectedBasemapId,
      setShowBasemap,
      setSelectedLayerIndex,
    ]
  );

  const handleTimeseriesClick = useCallback(
    (lat: number, lon: number) => {
      if (campaign?.mode === 'tasks') {
        setProbeTimeseriesPoint({ lat, lon });
      } else {
        setTimeseriesPoint({ lat, lon });
      }
    },
    [campaign?.mode, setTimeseriesPoint, setProbeTimeseriesPoint]
  );

  if (!campaign || !activeSource) return null;

  const isTaskMode = campaign.mode === 'tasks';
  const isOpenMode = campaign.mode === 'open';

  // Number of collections that are shown as windows
  const windowCollections = viewCollections.filter((r) => r.show_as_window);

  return (
    <div className="flex h-full w-full">
      <TimelineSidebar
        campaign={campaign}
        selectedViewId={selectedViewId}
        activeCollectionId={activeCollectionId}
        activeSliceIndex={activeSliceIndex}
        collapsed={timelineCollapsed}
        onToggleCollapse={() => setTimelineCollapsed((c) => !c)}
        onCollectionChange={setActiveCollectionId}
        onSliceChange={setActiveSliceIndex}
        onDraggingChange={setTimelineDragging}
        emptySlices={emptySlices}
      />
      <div className="flex-1 min-w-0 h-full relative">
        {/* Top-right controls for task mode */}
        {isTaskMode && (
          <div
            className="absolute top-2 right-2 z-[1000] flex gap-2 items-center"
            data-tour="map-controls"
          >
            {mapLayers.length > 0 && (
              <LayerSelector
                layers={mapLayers}
                selectedLayer={mapLayers.find((l) => l.id === activeLayerId)}
                onLayerSelect={handleLayerSelect}
              />
            )}

            {/* Collection selector */}
            {viewCollections.length > 1 && (
              <select
                value={activeCollectionId ?? ''}
                onChange={(e) => setActiveCollectionId(Number(e.target.value))}
                className="px-2 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-6 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
                title="Select collection (shift + a/d)"
              >
                {viewCollections.map((r) => (
                  <option key={r.collection_id} value={r.collection_id}>
                    {r.collection!.name}
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
                title="Select time slice (a/d)"
              >
                {slices.map((slice, idx) => {
                  const isEmpty = !!emptySlices[`${activeCollectionId}-${idx}`];
                  return (
                    <option
                      key={idx}
                      value={idx}
                      disabled={isEmpty}
                      style={isEmpty ? { color: '#aaa' } : undefined}
                    >
                      {slice.name}
                      {isEmpty ? ' (empty)' : ''}
                    </option>
                  );
                })}
              </select>
            )}

            <button
              onClick={triggerRefocus}
              className="px-2 py-1.5 bg-white text-neutral-900 rounded shadow hover:bg-neutral-50 transition-colors flex items-center cursor-pointer"
              title="Recenter map (Space)"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 3C10.5523 3 11 3.44772 11 4V5.07089C13.8377 5.50523 16 7.94291 16 10.9V11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H16V13.1C16 16.0571 13.8377 18.4948 11 18.9291V20C11 20.5523 10.5523 21 10 21C9.44772 21 9 20.5523 9 20V18.9291C6.16229 18.4948 4 16.0571 4 13.1V13H3C2.44772 13 2 12.5523 2 12C2 11.4477 2.44772 11 3 11H4V10.9C4 7.94291 6.16229 5.50523 9 5.07089V4C9 3.44772 9.44772 3 10 3ZM10 7C7.79086 7 6 8.79086 6 11V13C6 15.2091 7.79086 17 10 17C12.2091 17 14 15.2091 14 13V11C14 8.79086 12.2091 7 10 7Z" />
              </svg>
            </button>

            <button
              onClick={toggleCrosshair}
              className={`px-2 py-1.5 bg-white rounded shadow hover:bg-neutral-50 transition-colors flex items-center cursor-pointer ${showCrosshair ? 'text-neutral-900' : 'text-neutral-400'}`}
              title={showCrosshair ? 'Hide crosshair (O)' : 'Show crosshair (O)'}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <circle cx="10" cy="10" r="1.5" />
                <path d="M10 2V6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M10 14V18" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M2 10H6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M14 10H18" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>

            {windowCollections.length > 1 && (
              <button
                onClick={toggleViewSync}
                className={`px-2 py-1.5 rounded shadow transition-colors flex items-center gap-1 cursor-pointer ${viewSyncEnabled ? 'bg-brand-500 text-white hover:bg-brand-600' : 'bg-white text-neutral-400 hover:bg-neutral-50'}`}
                title={
                  viewSyncEnabled
                    ? 'Unlink (sync) small windows from main map pan/zoom (L)'
                    : 'Link (sync) small windows to main map pan/zoom (L)'
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {viewSyncEnabled ? (
                    <>
                      <rect x="1" y="3" width="7" height="6" rx="1" />
                      <rect x="12" y="11" width="7" height="6" rx="1" />
                      <path d="M8 8l1.5 1.5M10.5 10.5L12 12" />
                      <path d="M9 11l2-2" />
                    </>
                  ) : (
                    <>
                      <rect x="1" y="3" width="7" height="6" rx="1" />
                      <rect x="12" y="11" width="7" height="6" rx="1" />
                      <path d="M8 8l0.5 0.5" />
                      <path d="M11.5 11.5l0.5 0.5" />
                      <line x1="9" y1="12" x2="11" y2="9" strokeDasharray="1.5 1.5" />
                    </>
                  )}
                </svg>
              </button>
            )}

            {campaign.time_series.length > 0 && (
              <button
                onClick={() => setActiveTool(activeTool === 'timeseries' ? 'pan' : 'timeseries')}
                className={`px-2 py-1.5 rounded shadow transition-colors flex items-center cursor-pointer ${activeTool === 'timeseries' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-white text-neutral-900 hover:bg-neutral-50'}`}
                title={
                  activeTool === 'timeseries'
                    ? 'Deactivate timeseries probe'
                    : 'Activate timeseries probe'
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <polyline
                    points="2,16 5,10 8,12 11,6 14,9 17,3"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <circle cx="14" cy="14" r="4" fill="none" />
                  <line x1="17" y1="17" x2="19" y2="19" />
                </svg>
              </button>
            )}
          </div>
        )}

        {isOpenMode && (
          <div
            className="absolute top-2 right-2 z-[1000] flex gap-2 items-center"
            data-tour="map-controls"
          >
            {mapLayers.length > 0 && (
              <LayerSelector
                layers={mapLayers}
                selectedLayer={mapLayers.find((l) => l.id === activeLayerId)}
                onLayerSelect={handleLayerSelect}
              />
            )}

            {/* Collection selector */}
            {viewCollections.length > 1 && (
              <select
                value={activeCollectionId ?? ''}
                onChange={(e) => setActiveCollectionId(Number(e.target.value))}
                className="px-2 py-1.5 bg-white text-neutral-900 text-xs font-medium rounded shadow border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-6 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
                title="Select collection"
              >
                {viewCollections.map((r) => (
                  <option key={r.collection_id} value={r.collection_id}>
                    {r.collection!.name}
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
                  const isEmpty = !!emptySlices[`${activeCollectionId}-${idx}`];
                  return (
                    <option
                      key={idx}
                      value={idx}
                      disabled={isEmpty}
                      style={isEmpty ? { color: '#aaa' } : undefined}
                    >
                      {slice.name}
                      {isEmpty ? ' (empty)' : ''}
                    </option>
                  );
                })}
              </select>
            )}

            <button
              onClick={() => openModeMapRef.current?.fitAnnotations()}
              className="px-2 py-1.5 bg-white text-neutral-900 rounded shadow hover:bg-neutral-50 transition-colors flex items-center cursor-pointer"
              title="Fit view to all annotations (Space)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="14" height="14" rx="1" />
                <path d="M3 7h14M3 13h14M7 3v14M13 3v14" strokeWidth="1" opacity="0.4" />
                <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none" />
              </svg>
            </button>

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

            {windowCollections.length > 1 && (
              <button
                onClick={toggleViewSync}
                className={`px-2 py-1.5 rounded shadow transition-colors flex items-center gap-1 cursor-pointer ${viewSyncEnabled ? 'bg-brand-500 text-white hover:bg-brand-600' : 'bg-white text-neutral-400 hover:bg-neutral-50'}`}
                title={
                  viewSyncEnabled
                    ? 'Unlink (sync) small windows from main map pan/zoom (L)'
                    : 'Link (sync) small windows to main map pan/zoom (L)'
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {viewSyncEnabled ? (
                    <>
                      <rect x="1" y="3" width="7" height="6" rx="1" />
                      <rect x="12" y="11" width="7" height="6" rx="1" />
                      <path d="M8 8l1.5 1.5M10.5 10.5L12 12" />
                      <path d="M9 11l2-2" />
                    </>
                  ) : (
                    <>
                      <rect x="1" y="3" width="7" height="6" rx="1" />
                      <rect x="12" y="11" width="7" height="6" rx="1" />
                      <path d="M8 8l0.5 0.5" />
                      <path d="M11.5 11.5l0.5 0.5" />
                      <line x1="9" y1="12" x2="11" y2="9" strokeDasharray="1.5 1.5" />
                    </>
                  )}
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Map */}
        {isTaskMode ? (
          <TaskModeMap
            campaign={campaign}
            initialCenter={initialCenter}
            initialZoom={initialZoom}
            center={center}
            refocusTrigger={refocusTrigger}
            crosshair={crosshair}
            showCrosshair={showCrosshair}
            sampleExtent={showCrosshair ? sampleExtent : null}
            activeLayerId={activeLayerId}
            onLayersChange={(layers, id) => {
              setMapLayers(layers);
              setActiveLayerId(id);
            }}
            onViewChange={(newCenter, zoom, bounds) => {
              setMapCenter(newCenter);
              setMapZoom(zoom);
              setMapBounds(bounds);
            }}
            activeTool={activeTool}
            onTimeseriesClick={handleTimeseriesClick}
            probePoint={probeTimeseriesPoint}
          />
        ) : (
          <OpenModeMap
            ref={openModeMapRef}
            campaign={campaign}
            initialCenter={initialCenter}
            initialZoom={initialZoom}
            refocusTrigger={refocusTrigger}
            showCrosshair={showCrosshair}
            crosshairColor={activeSource?.crosshair_hex6 ?? undefined}
            activeLayerId={activeLayerId}
            onLayersChange={(layers, id) => {
              setMapLayers(layers);
              setActiveLayerId(id);
            }}
            onViewChange={(newCenter, zoom, bounds) => {
              setMapCenter(newCenter);
              setMapZoom(zoom);
              setMapBounds(bounds);
            }}
            selectedLabel={selectedLabel}
            activeTool={activeTool}
            magicWandActive={magicWandActive}
            onTimeseriesClick={handleTimeseriesClick}
            probePoint={timeseriesPoint}
          />
        )}
      </div>
    </div>
  );
};

export default memo(MainAnnotationsContainer);
