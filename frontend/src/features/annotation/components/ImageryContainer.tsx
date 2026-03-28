import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import WindowMap from './Map/WindowMap';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import {
  extractCentroidFromWKT,
  convertWKTToGeoJSON,
  computeExtentGeoJSON,
} from '~/shared/utils/utility';

interface ImageryContainerProps {
  collectionId: number;
  sourceId: number;
}

const ImageryContainer: React.FC<ImageryContainerProps> = ({ collectionId, sourceId }) => {
  const isDraggingRef = useRef(false);

  const campaign = useCampaignStore((s) => s.campaign);

  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);

  const refocusTrigger = useMapStore((s) => s.refocusTrigger);
  const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const collectionSliceIndices = useMapStore((s) => s.collectionSliceIndices);
  const currentMapCenter = useMapStore((s) => s.currentMapCenter);
  const currentMapZoom = useMapStore((s) => s.currentMapZoom);
  const viewSyncEnabled = useMapStore((s) => s.viewSyncEnabled);
  const showCrosshair = useMapStore((s) => s.showCrosshair);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);
  const setActiveSliceIndex = useMapStore((s) => s.setActiveSliceIndex);
  const markSliceEmpty = useMapStore((s) => s.markSliceEmpty);
  const emptySlices = useMapStore((s) => s.emptySlices);

  // Resolve collection and source from campaign
  const source = campaign?.imagery_sources.find((s) => s.id === sourceId) ?? null;
  const collection = source?.collections.find((c) => c.id === collectionId) ?? null;
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

  const isActiveCollection = collectionId === activeCollectionId;

  const slices = collection?.slices ?? [];

  // Use global slice index for active collection, stored index for others
  const currentSliceIndex = isActiveCollection
    ? activeSliceIndex
    : (collectionSliceIndices[collectionId] ?? 0);
  const activeSlice = slices[currentSliceIndex] ?? slices[0];

  // Resolve tile URL from pre-resolved slice tile_urls
  const allVizEntries = (campaign?.imagery_sources ?? []).flatMap((src) =>
    src.visualizations.map((v) => v.name)
  );
  const activeVizName = allVizEntries[selectedLayerIndex] ?? allVizEntries[0] ?? null;

  const tileUrl =
    activeSlice?.tile_urls.find((t) => t.visualization_name === activeVizName)?.tile_url ?? '';
  const loading = !activeSlice || !tileUrl;

  // Memoize latLon extraction (supports all geometry types via centroid)
  const latLon = useMemo(
    () => (currentTask ? extractCentroidFromWKT(currentTask.geometry.geometry) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTask?.geometry.geometry]
  );

  // Initial center for map mount
  const initialCenter = useMemo<[number, number]>(() => {
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox)
      return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return [0, 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reactive center - follows the main map when active or synced
  const center = useMemo<[number, number] | undefined>(() => {
    if (isActiveCollection || viewSyncEnabled) {
      if (currentMapCenter) return currentMapCenter;
    }
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox)
      return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMapCenter, latLon?.lat, latLon?.lon, isActiveCollection, viewSyncEnabled]);

  const zoom = useMemo(() => {
    if (isActiveCollection || viewSyncEnabled) {
      if (currentMapZoom !== null) return currentMapZoom;
    }
    return source?.default_zoom ?? 10;
  }, [currentMapZoom, source?.default_zoom, isActiveCollection, viewSyncEnabled]);

  // Detect whether the current task has a polygon geometry
  const isPolygonTask = useMemo(() => {
    if (isOpenMode || !currentTask) return false;
    const geojson = convertWKTToGeoJSON(currentTask.geometry.geometry);
    return !!geojson && (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTask?.geometry.geometry, isOpenMode]);

  const crosshair =
    !isOpenMode && latLon && !isPolygonTask
      ? { lat: latLon.lat, lon: latLon.lon, color: source?.crosshair_hex6 ?? undefined }
      : undefined;

  // Compute sample extent GeoJSON for the current task
  const sampleExtent = useMemo<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>(() => {
    if (isOpenMode || !currentTask) return null;
    const wkt = currentTask.geometry.geometry;
    const geojson = convertWKTToGeoJSON(wkt);
    if (geojson && (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon'))
      return geojson as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    if (latLon && campaign?.settings.sample_extent_meters) {
      return computeExtentGeoJSON(latLon.lat, latLon.lon, campaign.settings.sample_extent_meters);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentTask?.geometry.geometry,
    isOpenMode,
    campaign?.settings.sample_extent_meters,
    latLon?.lat,
    latLon?.lon,
  ]);

  // True once every slice for this collection has been confirmed empty
  const allSlicesEmpty =
    !isOpenMode && slices.length > 0 && slices.every((_, i) => emptySlices[`${collectionId}-${i}`]);

  const [emptyTileAlert, setEmptyTileAlert] = useState<string | null>(null);
  useEffect(() => {
    setEmptyTileAlert(null);
  }, [tileUrl]);

  const emptyTilesStateRef = useRef({
    collectionId,
    activeSlice,
    sliceKey: `${collectionId}-${currentSliceIndex}`,
    isActiveCollection,
    slices,
    currentSliceIndex,
    emptySlices,
    markSliceEmpty,
    setActiveSliceIndex,
    setCollectionSliceIndex: useMapStore.getState().setCollectionSliceIndex,
    setEmptyTileAlert,
    collectionName: collection?.name ?? '',
  });
  emptyTilesStateRef.current = {
    collectionId,
    activeSlice,
    sliceKey: `${collectionId}-${currentSliceIndex}`,
    isActiveCollection,
    slices,
    currentSliceIndex,
    emptySlices,
    markSliceEmpty,
    setActiveSliceIndex,
    setCollectionSliceIndex: useMapStore.getState().setCollectionSliceIndex,
    setEmptyTileAlert,
    collectionName: collection?.name ?? '',
  };

  const handleEmptyTiles = useCallback(() => {
    if (isOpenMode) return;
    const {
      collectionId: colId,
      activeSlice: slice,
      sliceKey: key,
      isActiveCollection: isActive,
      slices: allSlices,
      currentSliceIndex: curIdx,
      emptySlices: empty,
      markSliceEmpty: mark,
      setActiveSliceIndex: setActive,
      setCollectionSliceIndex: setStored,
      setEmptyTileAlert: setAlert,
      collectionName,
    } = emptyTilesStateRef.current;

    const sliceLabel = slice?.name ?? '';
    const alertLabel = sliceLabel ? `${collectionName} - ${sliceLabel}` : collectionName;

    mark(key);

    const nextIndex = allSlices.findIndex((_, i) => i !== curIdx && !empty[`${colId}-${i}`]);

    if (nextIndex !== -1) {
      if (isActive) {
        setActive(nextIndex);
      } else {
        setStored(colId, nextIndex);
      }
      return;
    }

    setAlert(alertLabel);
  }, []); // stable - all state read from ref

  if (!collection || !campaignBbox) return null;

  const handleMouseDown = () => {
    isDraggingRef.current = false;
  };
  const handleMouseMove = () => {
    isDraggingRef.current = true;
  };
  const handleMouseUp = () => {
    if (!isDraggingRef.current) setActiveCollectionId(collectionId);
    isDraggingRef.current = false;
  };

  const handleSliceChange = (index: number) => {
    if (isActiveCollection) {
      setActiveSliceIndex(index);
    } else {
      useMapStore.getState().setCollectionSliceIndex(collectionId, index);
    }
  };

  return (
    <div
      className="flex-1 relative overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
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
              const key = `${collectionId}-${idx}`;
              const isEmpty = !isOpenMode && emptySlices[key];
              return (
                <option
                  key={idx}
                  value={idx}
                  disabled={!!isEmpty}
                  style={isEmpty ? { color: '#aaa' } : undefined}
                >
                  {slice.name}
                  {isEmpty ? ' (empty)' : ''}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100/80 z-[999] text-neutral-500 text-[10px] pointer-events-none">
          Loading…
        </div>
      )}

      {allSlicesEmpty ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-neutral-100 text-neutral-500 select-none">
          <svg
            className="w-6 h-6 text-neutral-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75 7.5 10.5l4.5 4.5 3-3 4.5 4.5M3.75 19.5h16.5M3.75 4.5h16.5"
            />
          </svg>
          <span className="text-[10px] font-medium text-neutral-400 text-center px-2 leading-snug">
            No imagery available
          </span>
        </div>
      ) : (
        <>
          {emptyTileAlert && (
            <div className="absolute top-1 left-1 right-1 z-[1001] flex items-start gap-1 bg-amber-50 border border-amber-400 rounded px-2 py-1 text-[10px] text-amber-800 shadow-sm">
              <span className="flex-1">
                No imagery data for <strong>{emptyTileAlert}</strong>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEmptyTileAlert(null);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="ml-1 text-amber-600 hover:text-amber-900 font-bold leading-none"
                title="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {!loading && (tileUrl || isOpenMode) ? (
            <WindowMap
              initialCenter={initialCenter}
              initialZoom={zoom}
              center={center}
              zoom={zoom}
              tileUrl={tileUrl}
              crosshair={crosshair}
              showCrosshair={!isOpenMode && showCrosshair}
              refocusTrigger={refocusTrigger}
              detectionKey={currentTaskIndex}
              onEmptyTiles={handleEmptyTiles}
              sampleExtent={showCrosshair ? sampleExtent : null}
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
