import { useEffect, useMemo, useState, useCallback, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import TaskModeMap from './Map/TaskModeMap';
import {
  resolvePreloadTier,
  resolvePreloadConcurrency,
  getAutoPreloadTier,
  PRELOAD_TIER_CONCURRENCY,
} from './Map/useTilePreloading';
import { usePreferencesStore, type PreloadMode } from '../stores/preferences.store';
import OpenModeMap from './Map/OpenModeMap';
import type { OpenModeMapHandle } from './Map/OpenModeMap';
import TimelineSidebar from './TimelineSidebar';
import LayerSelector from './Map/LayerSelector';
import type { Layer } from './Map/LayerSelector';
import HeaderSelect from './Map/HeaderSelect';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import {
  extractCentroidFromWKT,
  computeExtentGeoJSON,
  convertWKTToGeoJSON,
} from '~/shared/utils/utility';
import { extendLabelsWithMetadata } from '../utils/labelMetadata';

interface MainAnnotationsContainerProps {
  commentInputRef?: React.RefObject<HTMLTextAreaElement | null>;
  headerSlotRef?: React.RefObject<HTMLDivElement | null>;
}

export const MainAnnotationsContainer = ({
  commentInputRef: _commentInputRef,
  headerSlotRef,
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
  const setSliceNavIntent = useMapStore((s) => s.setSliceNavIntent);

  /**
   * Slice change triggered by a deliberate user pick (dropdown / timeline).
   * Marks the intent as 'pick' so ImageryContainer's empty-probe does not
   * auto-skip away from an explicitly-selected empty slice.
   */
  const pickSlice = (index: number) => {
    setSliceNavIntent('pick');
    setActiveSliceIndex(index);
  };
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

  const preloadMode = usePreferencesStore((s) => s.preloadMode);
  const setPreloadMode = usePreferencesStore((s) => s.setPreloadMode);
  const autoTier = useMemo(() => getAutoPreloadTier(), []);
  const effectiveTier = resolvePreloadTier(preloadMode);
  const effectiveConcurrency = resolvePreloadConcurrency(preloadMode);
  const preloadActive = effectiveConcurrency > 0;
  const preloadTierMeta: Record<string, { label: string; dot: string }> = {
    off: { label: 'Off', dot: 'bg-neutral-400' },
    conservative: { label: 'Conservative', dot: 'bg-orange-500' },
    balanced: { label: 'Balanced', dot: 'bg-yellow-500' },
    heavy: { label: 'Heavy', dot: 'bg-green-500' },
  };
  const effectiveTierMeta = preloadTierMeta[effectiveTier];

  const [preloadMenuOpen, setPreloadMenuOpen] = useState(false);
  const preloadMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!preloadMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!preloadMenuRef.current?.contains(e.target as Node)) setPreloadMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreloadMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [preloadMenuOpen]);

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
        // Extract collection id and viz name from layer id: tile-c{id}-s{idx}-v{vizName}
        const cMatch = layerId.match(/^tile-c(\d+)-s/);
        const collectionId = cMatch ? Number(cMatch[1]) : null;
        const vIdx = layerId.indexOf('-v');
        if (vIdx !== -1) {
          const vizName = layerId.slice(vIdx + 2);
          // Switch to the collection if it belongs to a different source
          if (collectionId != null && collectionId !== activeCollectionId) {
            setActiveCollectionId(collectionId);
          }
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
      activeCollectionId,
      setActiveLayerId,
      setActiveCollectionId,
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
        onSliceChange={pickSlice}
        onDraggingChange={setTimelineDragging}
        emptySlices={emptySlices}
      />
      <div className="flex-1 min-w-0 h-full relative">
        {/* Header controls – rendered via portal into the card header slot in Canvas */}
        {headerSlotRef?.current &&
          createPortal(
            <>
              {/* Selectors */}
              {mapLayers.length > 0 && (
                <div data-tour="layer-selector">
                  <LayerSelector
                    layers={mapLayers}
                    selectedLayer={mapLayers.find((l) => l.id === activeLayerId)}
                    onLayerSelect={handleLayerSelect}
                  />
                </div>
              )}

              {viewCollections.length > 1 && (
                <HeaderSelect
                  value={activeCollectionId ?? ''}
                  options={viewCollections.map((r) => ({
                    value: r.collection_id,
                    label: r.collection!.name,
                  }))}
                  onChange={(v) => setActiveCollectionId(Number(v))}
                  title={isTaskMode ? 'Select collection (shift + a/d)' : 'Select collection'}
                />
              )}

              {slices.length > 1 && (
                <HeaderSelect
                  value={activeSliceIndex}
                  options={slices.map((slice, idx) => {
                    const isEmpty = !!emptySlices[`${activeCollectionId}-${idx}`];
                    return {
                      value: idx,
                      label: `${slice.name}${isEmpty ? ' (empty)' : ''}`,
                      dimmed: isEmpty,
                    };
                  })}
                  onChange={(v) => pickSlice(Number(v))}
                  title={isTaskMode ? 'Select time slice (a/d)' : 'Select time slice'}
                />
              )}

              {/* Divider */}
              <div className="w-px h-3 bg-neutral-200 mx-0.5" />

              {/* Actions */}
              {isTaskMode ? (
                <button
                  onClick={triggerRefocus}
                  className="w-6 h-6 text-neutral-400 rounded-md hover:bg-neutral-100 hover:text-neutral-600 transition-colors flex items-center justify-center cursor-pointer"
                  title="Recenter map (Space)"
                >
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 3C10.5523 3 11 3.44772 11 4V5.07089C13.8377 5.50523 16 7.94291 16 10.9V11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H16V13.1C16 16.0571 13.8377 18.4948 11 18.9291V20C11 20.5523 10.5523 21 10 21C9.44772 21 9 20.5523 9 20V18.9291C6.16229 18.4948 4 16.0571 4 13.1V13H3C2.44772 13 2 12.5523 2 12C2 11.4477 2.44772 11 3 11H4V10.9C4 7.94291 6.16229 5.50523 9 5.07089V4C9 3.44772 9.44772 3 10 3ZM10 7C7.79086 7 6 8.79086 6 11V13C6 15.2091 7.79086 17 10 17C12.2091 17 14 15.2091 14 13V11C14 8.79086 12.2091 7 10 7Z" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={() => openModeMapRef.current?.fitAnnotations()}
                  className="w-6 h-6 text-neutral-400 rounded-md hover:bg-neutral-100 hover:text-neutral-600 transition-colors flex items-center justify-center cursor-pointer"
                  title="Fit view to all annotations (Space)"
                >
                  <svg
                    width="13"
                    height="13"
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
              )}

              <button
                onClick={toggleCrosshair}
                className={`w-6 h-6 rounded-md transition-colors flex items-center justify-center cursor-pointer ${showCrosshair ? 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700' : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'}`}
                title={showCrosshair ? 'Hide crosshair (O)' : 'Show crosshair (O)'}
              >
                <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
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
                  className={`w-6 h-6 rounded-md transition-colors flex items-center justify-center cursor-pointer ${viewSyncEnabled ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'}`}
                  title={
                    viewSyncEnabled
                      ? 'Unlink (sync) small windows from main map pan/zoom (L)'
                      : 'Link (sync) small windows to main map pan/zoom (L)'
                  }
                >
                  <svg
                    width="13"
                    height="13"
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

              {isTaskMode && (
                <div ref={preloadMenuRef} className="relative">
                  <button
                    onClick={() => setPreloadMenuOpen((o) => !o)}
                    className={`relative w-6 h-6 rounded-md transition-colors flex items-center justify-center cursor-pointer ${
                      preloadActive
                        ? 'bg-brand-600 text-white hover:bg-brand-700'
                        : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'
                    }`}
                    title={`Tile preloading: ${effectiveTierMeta.label}${
                      preloadMode === 'auto' ? ' (auto-tuned to your connection)' : ''
                    }. Click to change.`}
                    aria-haspopup="menu"
                    aria-expanded={preloadMenuOpen}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10 2v4M10 14v4" />
                      <path d="M4.93 4.93l2.83 2.83M12.24 12.24l2.83 2.83" />
                      <path d="M2 10h4M14 10h4" />
                      {!preloadActive && <line x1="3" y1="17" x2="17" y2="3" strokeWidth="2" />}
                    </svg>
                    <span
                      className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ring-1 ring-white ${effectiveTierMeta.dot}`}
                      aria-hidden
                    />
                  </button>
                  {preloadMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border border-neutral-200 bg-white shadow-lg py-1 text-xs"
                    >
                      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-neutral-400">
                        Tile preloading
                      </div>
                      {(
                        [
                          {
                            mode: 'auto',
                            label: 'Auto',
                            hint: `tuned to your connection (currently ${preloadTierMeta[autoTier].label.toLowerCase()})`,
                          },
                          { mode: 'off', label: 'Off', hint: 'no preloading' },
                          {
                            mode: 'conservative',
                            label: 'Conservative',
                            hint: `${PRELOAD_TIER_CONCURRENCY.conservative} parallel — slow links`,
                          },
                          {
                            mode: 'balanced',
                            label: 'Balanced',
                            hint: `${PRELOAD_TIER_CONCURRENCY.balanced} parallel — typical 4G/wifi`,
                          },
                          {
                            mode: 'heavy',
                            label: 'Heavy',
                            hint: `${PRELOAD_TIER_CONCURRENCY.heavy} parallel — fast wired/wifi`,
                          },
                        ] as { mode: PreloadMode; label: string; hint: string }[]
                      ).map((opt) => {
                        const selected = preloadMode === opt.mode;
                        return (
                          <button
                            key={opt.mode}
                            role="menuitemradio"
                            aria-checked={selected}
                            onClick={() => {
                              setPreloadMode(opt.mode);
                              setPreloadMenuOpen(false);
                            }}
                            className={`flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 ${
                              selected ? 'bg-neutral-50' : ''
                            }`}
                          >
                            <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0">
                              {selected && (
                                <span className="block w-1.5 h-1.5 rounded-full bg-brand-600" />
                              )}
                            </span>
                            <span className="flex-1">
                              <span className="block text-neutral-800">{opt.label}</span>
                              <span className="block text-[10px] text-neutral-400">{opt.hint}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {campaign.time_series.length > 0 && (
                <button
                  onClick={() => setActiveTool(activeTool === 'timeseries' ? 'pan' : 'timeseries')}
                  className={`w-6 h-6 rounded-md transition-colors flex items-center justify-center cursor-pointer ${activeTool === 'timeseries' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600'}`}
                  title={
                    activeTool === 'timeseries'
                      ? 'Deactivate timeseries probe'
                      : 'Activate timeseries probe: Pick a point on the map to load the timeseries for that location (T)'
                  }
                >
                  <svg
                    width="13"
                    height="13"
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
            </>,
            headerSlotRef.current
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
