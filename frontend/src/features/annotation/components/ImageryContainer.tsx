import { useRef, useMemo, useState, useEffect, memo } from 'react';
import WindowMap from './Map/WindowMap';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import {
  extractCentroidFromWKT,
  convertWKTToGeoJSON,
  computeExtentGeoJSON,
} from '~/shared/utils/utility';
import { isSelfHostedTiler } from '../utils/tileLoading';
import { isProxiedTileUrl, resolveSliceTileUrl } from '../utils/proxyTile';
import { sliceView, resolveSliceIndex } from '../utils/sliceView';
import { ensureTilerSession } from '~/api/tilerToken';

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
  const workMode = useCampaignStore((s) => s.workMode);

  // Re-mint the tiler cookie on campaign entry so a just-created / just-joined campaign is
  // covered (the cookie snapshots memberships at mint time). Keyed on campaign id, so the
  // many collection windows of one campaign dedupe to a single mint.
  useEffect(() => {
    if (campaign?.id != null) void ensureTilerSession(String(campaign.id));
  }, [campaign?.id]);

  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);

  const refocusTrigger = useMapStore((s) => s.refocusTrigger);
  const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  // Per-collection, so another window's slice change doesn't re-render this one.
  const sliceIndexForCollection = useMapStore((s) => s.collectionSliceIndices[collectionId]);
  const viewSyncEnabled = useMapStore((s) => s.viewSyncEnabled);
  // WindowMap follows the live center/zoom imperatively (its `follow` prop), so
  // we only pass this flag - reading live center/zoom here would re-render us per frame.
  const isFollowing = collectionId === activeCollectionId || viewSyncEnabled;
  const showCrosshair = useMapStore((s) => s.showCrosshair);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);

  // Resolve collection and source from campaign
  const source = useMemo(
    () => campaign?.imagery_sources.find((s) => s.id === sourceId) ?? null,
    [campaign, sourceId]
  );
  const collection = useMemo(
    () => source?.collections.find((c) => c.id === collectionId) ?? null,
    [source, collectionId]
  );
  const currentTask = visibleTasks[currentTaskIndex] || null;
  const isOpenMode = workMode === 'explore';
  const campaignBbox = campaign
    ? ([
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
      ] as [number, number, number, number])
    : null;

  const slices = collection?.slices ?? [];

  const currentSliceIndex = resolveSliceIndex(collection, sliceIndexForCollection);
  const activeSlice = slices[currentSliceIndex] ?? slices[0];

  // Resolve which viz to show in this window.
  // selectedLayerIndex is global. We convert it to a position within the
  // active source, then apply that same position to this window's source.
  // If this window belongs to a different source, it stays on viz 0.
  const activeVizName = useMemo(() => {
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
    return ownerSource?.visualizations[vizIndex]?.name ?? null;
  }, [campaign, collectionId, activeCollectionId, selectedLayerIndex]);

  const activeEntry = useMemo(
    () => activeSlice?.tile_urls.find((t) => t.visualization_name === activeVizName) ?? null,
    [activeSlice, activeVizName]
  );
  const tileUrl =
    activeEntry && campaign?.id != null && activeSlice?.id != null
      ? resolveSliceTileUrl(campaign.id, activeSlice.id, activeEntry)
      : '';
  const tileProvider = activeEntry?.tile_provider ?? null;
  const loading = !activeSlice || !tileUrl;

  // Memoize latLon extraction (supports all geometry types via centroid)
  const latLon = useMemo(
    () => (currentTask ? extractCentroidFromWKT(currentTask.geometry.geometry) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTask?.geometry.geometry]
  );

  // Center the OL view is (re)created at. Kept current to the task so a window
  // remounted by virtualization after navigation opens at the current task, not
  // a stale one. (For followers, the follow effect then snaps to the main map.)
  const initialCenter = useMemo<[number, number]>(() => {
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox)
      return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return [0, 0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latLon?.lat, latLon?.lon]);

  // Resting position (task centroid / bbox); live follow motion is imperative in WindowMap.
  const center = useMemo<[number, number] | undefined>(() => {
    if (latLon) return [latLon.lat, latLon.lon];
    if (campaignBbox)
      return [(campaignBbox[1] + campaignBbox[3]) / 2, (campaignBbox[0] + campaignBbox[2]) / 2];
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latLon?.lat, latLon?.lon]);

  const zoom = source?.default_zoom ?? 10;

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

  // Derived boolean for this collection only, so another window's empty-slice
  // change doesn't re-render us.
  const allSlicesEmpty = useMapStore(
    (s) =>
      !isOpenMode &&
      slices.length > 0 &&
      slices.every((_, i) => !!s.emptySlices[`${collectionId}-${i}`])
  );

  const [emptyTileAlert, setEmptyTileAlert] = useState<string | null>(null);
  // Slice being probed while the effect searches a mostly-empty collection for
  // imagery. Text-only state - it never changes tileUrl, so it gives the user
  // progress feedback without rebuilding the OL source.
  const [probingLabel, setProbingLabel] = useState<string | null>(null);

  // Build the tile URL at the crosshair position for any slice, for empty-slice
  // probing. Always uses default_zoom + task centroid so zooming doesn't
  // re-trigger detection. Probing a slice this way (a single background fetch)
  // never touches the rendered map, so resolving an empty collection doesn't
  // churn the OL source per slice.
  const defaultZoom = source?.default_zoom ?? 10;
  const buildCrosshairTileUrl = (sliceIdx: number): string | null => {
    if (!latLon) return null;
    const entry = slices[sliceIdx]?.tile_urls.find((t) => t.visualization_name === activeVizName);
    if (!entry?.tile_url) return null;
    const sliceId = slices[sliceIdx]?.id;
    const base =
      campaign?.id != null && sliceId != null
        ? resolveSliceTileUrl(campaign.id, sliceId, entry)
        : entry.tile_url;
    const z = Math.round(defaultZoom);
    const n = Math.pow(2, z);
    const x = Math.floor(((latLon.lon + 180) / 360) * n);
    const yRad = (latLon.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(yRad) + 1 / Math.cos(yRad)) / Math.PI) / 2) * n);
    return base.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  };
  const crosshairTileUrl = useMemo(
    () => buildCrosshairTileUrl(currentSliceIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slices, activeVizName, defaultZoom, latLon, currentSliceIndex]
  );

  // Probe the crosshair tile to detect empty slices. If the current slice is
  // empty, keep probing candidate slices in the background (forward, then
  // backward, then any) and commit ONCE to the first non-empty one. This avoids
  // advancing the rendered slice per probe - which would rebuild the OL source
  // each step and stall the main thread when a collection is mostly empty.
  // Self-hosted tiles need an auth token; MPC tiles are fetched directly.
  useEffect(() => {
    if (isOpenMode || !crosshairTileUrl) return;
    setEmptyTileAlert(null);
    setProbingLabel(null);

    const controller = new AbortController();

    // Resolves true when the tile is empty (no content / not found). Our tilers return
    // 204 for an empty tile; auth is via the cookie (credentials: 'include').
    const probeEmpty = async (url: string): Promise<boolean> => {
      // Self-hosted tilers and our key-proxy both need the tiler cookie; MPC/public don't.
      const credentialed = isSelfHostedTiler(tileProvider) || isProxiedTileUrl(url);
      let resp: Response;
      if (credentialed) {
        await ensureTilerSession();
        resp = await fetch(url, {
          mode: 'cors',
          credentials: 'include',
          signal: controller.signal,
        });
      } else {
        resp = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
      }
      return resp.status === 204 || (!credentialed && !resp.ok);
    };

    (async () => {
      if (!(await probeEmpty(crosshairTileUrl))) return;

      const knownEmpty = useMapStore.getState().emptySlices;
      const newlyEmpty = new Set<number>([currentSliceIndex]);

      // Candidate order: forward first (stay within the time series), then
      // backward, then any remaining slice (e.g. a custom cover) as last resort.
      const { navIndices } = sliceView(
        slices.length,
        collection?.cover_slice_index,
        collection?.has_dedicated_cover
      );
      const forward = navIndices.filter((i) => i > currentSliceIndex);
      const backward = [...navIndices].reverse().filter((i) => i < currentSliceIndex);
      const rest = slices
        .map((_, i) => i)
        .filter((i) => i !== currentSliceIndex && !navIndices.includes(i));

      let resolved = -1;
      for (const i of [...forward, ...backward, ...rest]) {
        if (newlyEmpty.has(i) || knownEmpty[`${collectionId}-${i}`]) continue;
        const url = buildCrosshairTileUrl(i);
        if (!url) continue;
        setProbingLabel(slices[i]?.name ?? null);
        if (await probeEmpty(url)) {
          newlyEmpty.add(i);
        } else {
          resolved = i;
          break;
        }
      }

      setProbingLabel(null);
      useMapStore.getState().markSlicesEmpty([...newlyEmpty].map((i) => `${collectionId}-${i}`));

      if (resolved !== -1) {
        useMapStore.getState().setCollectionSliceIndex(collectionId, resolved);
      } else {
        const sliceLabel = activeSlice?.name ?? '';
        const colName = collection?.name ?? '';
        setEmptyTileAlert(sliceLabel ? `${colName} - ${sliceLabel}` : colName);
      }
    })().catch(() => {
      // fetch aborted or network error - ignore
      setProbingLabel(null);
    });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crosshairTileUrl, isOpenMode, currentSliceIndex, collectionId, tileProvider]);

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
      className="flex-1 relative overflow-hidden select-none bg-neutral-200"
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

      {probingLabel && (
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-[1002] flex items-center gap-1.5 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white pointer-events-none">
          <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-white/40 border-t-white" />
          Searching imagery… {probingLabel}
        </div>
      )}

      {allSlicesEmpty ? (
        <NoImageryOverlay />
      ) : (
        <>
          {emptyTileAlert && (
            <div className="absolute inset-0 z-[1001] grid place-items-center p-4 pointer-events-none">
              <span className="text-xs text-neutral-500">no data</span>
            </div>
          )}

          {!loading && (tileUrl || isOpenMode) ? (
            <WindowMap
              initialCenter={initialCenter}
              initialZoom={zoom}
              center={center}
              zoom={zoom}
              follow={isFollowing}
              tileUrl={tileUrl}
              tileProvider={tileProvider}
              crosshair={crosshair}
              showCrosshair={!isOpenMode && showCrosshair && !emptyTileAlert}
              refocusTrigger={refocusTrigger}
              detectionKey={currentTaskIndex}
              sampleExtent={!emptyTileAlert && showCrosshair ? sampleExtent : null}
            />
          ) : (
            !loading && <NoImageryOverlay />
          )}
        </>
      )}
    </div>
  );
};

export default memo(ImageryContainer);
