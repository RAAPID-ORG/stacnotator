import { useRef, useMemo, useState, useEffect } from 'react';
import WindowMap from './Map/WindowMap';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import {
  extractCentroidFromWKT,
  convertWKTToGeoJSON,
  computeExtentGeoJSON,
} from '~/shared/utils/utility';
import { buildTileUrl } from '../utils/tileLoading';
import { getTilerToken } from '~/api/tilerToken';

const TILER_BASE = import.meta.env.VITE_TILER_BASE_URL || import.meta.env.VITE_API_BASE_URL || '';

/** Hatched overlay indicating no imagery is available for this tile/area */
function NoImageryOverlay() {
  return (
    <div className="w-full h-full relative bg-neutral-50 select-none overflow-hidden">
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="hatch"
            patternUnits="userSpaceOnUse"
            width="12"
            height="12"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="12" stroke="#d4d4d4" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hatch)" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-medium text-neutral-400 bg-neutral-50/80 px-2 py-0.5 rounded">
          No imagery
        </span>
      </div>
    </div>
  );
}

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

  // Resolve which viz to show in this window.
  // selectedLayerIndex is global. We convert it to a position within the
  // active source, then apply that same position to this window's source.
  // If this window belongs to a different source, it stays on viz 0.
  const sources = campaign?.imagery_sources ?? [];
  const ownerSource = sources.find((s) => s.collections.some((c) => c.id === collectionId));
  const mainSource = sources.find((s) => s.collections.some((c) => c.id === activeCollectionId));

  let vizIndex = 0;
  if (ownerSource && mainSource && ownerSource.id === mainSource.id) {
    // Same source as the main map - compute position within this source
    let offset = 0;
    for (const s of sources) {
      if (s.id === mainSource.id) break;
      offset += s.visualizations.length;
    }
    vizIndex = Math.min(
      Math.max(0, selectedLayerIndex - offset),
      ownerSource.visualizations.length - 1
    );
  }

  const activeVizName = ownerSource?.visualizations[vizIndex]?.name ?? null;
  const tileUrlEntry = activeSlice?.tile_urls.find((t) => t.visualization_name === activeVizName);
  const tileUrl = tileUrlEntry
    ? buildTileUrl({ tile_url: tileUrlEntry.tile_url, tile_provider: tileUrlEntry.tile_provider })
    : '';
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

  // True once every slice for this collection has been confirmed empty at the crosshair
  const allSlicesEmpty =
    !isOpenMode && slices.length > 0 && slices.every((_, i) => emptySlices[`${collectionId}-${i}`]);

  const [emptyTileAlert, setEmptyTileAlert] = useState<string | null>(null);

  // Compute the tile URL at the crosshair position for empty-slice probing.
  // Always uses default_zoom + task centroid so zooming doesn't re-trigger detection.
  const defaultZoom = source?.default_zoom ?? 10;
  const crosshairTileUrl = useMemo(() => {
    if (!tileUrl || !latLon) return null;
    const z = Math.round(defaultZoom);
    const n = Math.pow(2, z);
    const x = Math.floor(((latLon.lon + 180) / 360) * n);
    const yRad = (latLon.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(yRad) + 1 / Math.cos(yRad)) / Math.PI) / 2) * n);
    return tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }, [tileUrl, latLon, defaultZoom]);

  // Probe the crosshair tile to detect empty slices.
  // One lightweight fetch per task/slice change - not per tile.
  // Self-hosted tiles need an auth token; MPC tiles are fetched directly.
  useEffect(() => {
    if (isOpenMode || !crosshairTileUrl) return;
    setEmptyTileAlert(null);

    const controller = new AbortController();
    const isSelfHosted = TILER_BASE && crosshairTileUrl.startsWith(TILER_BASE);

    const doFetch = isSelfHosted
      ? getTilerToken().then((token) => {
          const sep = crosshairTileUrl.includes('?') ? '&' : '?';
          return fetch(`${crosshairTileUrl}${sep}token=${encodeURIComponent(token)}`, {
            mode: 'cors',
            credentials: 'omit',
            signal: controller.signal,
          });
        })
      : fetch(crosshairTileUrl, { mode: 'cors', credentials: 'omit', signal: controller.signal });

    doFetch
      .then((resp) => {
        // 204 = no content (MPC returns this for empty tiles).
        // Non-ok (404/500) also means no data.
        // Self-hosted tiler returns 200 + transparent PNG for empty - skip.
        if (resp.status === 204 || (!isSelfHosted && !resp.ok)) {
          // fall through to mark empty
        } else {
          return;
        }

        const sliceKey = `${collectionId}-${currentSliceIndex}`;
        const alreadyKnownEmpty = !!emptySlices[sliceKey];
        markSliceEmpty(sliceKey);
        if (alreadyKnownEmpty) return;

        // Decide whether (and in which direction) to auto-skip based on the
        // most recent navigation intent. Read it fresh here rather than as a
        // dep so we see the latest value even if the producer set it on the
        // same tick as the slice change.
        const intent = useMapStore.getState().sliceNavIntent;
        if (intent === 'pick') {
          // User explicitly picked this slice. Respect it - they get to see
          // the empty tile. No auto-skip, no alert.
          return;
        }

        const currentEmpty = { ...emptySlices, [sliceKey]: true as const };
        let nextIndex = -1;
        if (intent === 'next') {
          for (let i = currentSliceIndex + 1; i < slices.length; i++) {
            if (!currentEmpty[`${collectionId}-${i}`]) {
              nextIndex = i;
              break;
            }
          }
        } else if (intent === 'prev') {
          for (let i = currentSliceIndex - 1; i >= 0; i--) {
            if (!currentEmpty[`${collectionId}-${i}`]) {
              nextIndex = i;
              break;
            }
          }
        } else {
          // 'initial' - fresh load, land on first non-empty anywhere.
          nextIndex = slices.findIndex(
            (_, i) => i !== currentSliceIndex && !currentEmpty[`${collectionId}-${i}`]
          );
        }

        if (nextIndex !== -1) {
          if (isActiveCollection) {
            setActiveSliceIndex(nextIndex);
          } else {
            useMapStore.getState().setCollectionSliceIndex(collectionId, nextIndex);
          }
        } else {
          const sliceLabel = activeSlice?.name ?? '';
          const colName = collection?.name ?? '';
          setEmptyTileAlert(sliceLabel ? `${colName} - ${sliceLabel}` : colName);
        }
      })
      .catch(() => {
        // fetch aborted or network error - ignore
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crosshairTileUrl, isOpenMode, currentSliceIndex, collectionId]);

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

  return (
    <div
      className="flex-1 relative overflow-hidden select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Slice dropdown lives in the card header (see Canvas.tsx), not in
          the imagery body, so it doesn't steal space from the tile view. */}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100/80 z-[999] text-neutral-500 text-[10px] pointer-events-none">
          Loading…
        </div>
      )}

      {allSlicesEmpty ? (
        <NoImageryOverlay />
      ) : (
        <>
          {emptyTileAlert && (
            <div className="absolute top-1.5 left-1.5 right-1.5 z-[1001] flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 text-[11px] text-amber-800 shadow-sm">
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
              sampleExtent={showCrosshair ? sampleExtent : null}
            />
          ) : (
            !loading && <NoImageryOverlay />
          )}
        </>
      )}
    </div>
  );
};

export default ImageryContainer;
