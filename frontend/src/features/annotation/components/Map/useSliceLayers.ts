import { useEffect, useRef, useState, useCallback } from 'react';
import type { LayerManager } from './layerManager';
import { XYZLayer } from './Layer';
import type { Layer } from './Layer';
import type { CampaignOutFull } from '~/api/client';
import { buildTileUrl } from './tileUrlBuilder';
import { useMapStore } from '../../stores/map.store';
import { useCampaignStore } from '../../stores/campaign.store';

/** Return an attribution string for known basemap providers based on their URL pattern. */
function getBasemapAttribution(url: string): string | undefined {
  const u = url.toLowerCase();
  if (u.includes('carto'))
    return '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  if (u.includes('opentopomap'))
    return '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>) &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  if (u.includes('arcgisonline') || u.includes('esri'))
    return '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Sources: Esri, Maxar, Earthstar Geographics';
  if (u.includes('openstreetmap'))
    return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  return undefined;
}

/** Stable layer ID: `tile-c{collectionId}-s{sliceIndex}-v{vizName}` */
export function makeLayerId(collectionId: number, sliceIndex: number, vizName: string): string {
  return `tile-c${collectionId}-s${sliceIndex}-v${vizName}`;
}

interface UseSliceLayersOptions {
  campaign: CampaignOutFull | null;
  layerManager: LayerManager | null;
  mapReady: boolean;
  onReady?: () => void;
  onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
  preloadDepth?: number;
}

/**
 * Manages OL layer registration + active layer selection.
 *
 * - Registers basemap layers from campaign.basemaps
 * - Registers imagery layers from pre-resolved slice tile_urls
 * - Builds UI layer list: one entry per (source × visualization) + basemaps
 */
export function useSliceLayers({
  campaign,
  layerManager,
  mapReady,
  onReady,
  onLayersChange,
  preloadDepth,
}: UseSliceLayersOptions) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState('');

  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
  const showBasemap = useMapStore((s) => s.showBasemap);
  const selectedBasemapId = useMapStore((s) => s.selectedBasemapId);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const hasCalledOnReadyRef = useRef(false);
  const prevViewIdRef = useRef<number | null>(null);

  // Resolve active collection and its source
  const activeSource = (() => {
    if (!campaign || !activeCollectionId) return null;
    return (
      campaign.imagery_sources.find((s) =>
        s.collections.some((c) => c.id === activeCollectionId)
      ) ?? null
    );
  })();

  const activeCollection =
    activeSource?.collections.find((c) => c.id === activeCollectionId) ?? null;

  // Build the flat list of viz names from all sources (for layer cycling)
  const allVizEntries = (campaign?.imagery_sources ?? []).flatMap((src) =>
    src.visualizations.map((v) => ({ sourceName: src.name, vizName: v.name, vizId: v.id }))
  );
  const activeVizEntry = allVizEntries[selectedLayerIndex] ?? allVizEntries[0] ?? null;

  const activateCorrectLayer = useCallback(
    (lm: LayerManager) => {
      if (!campaign || !activeCollection || !activeSource) return;

      let targetId: string;

      if (showBasemap && selectedBasemapId) {
        targetId = selectedBasemapId;
      } else {
        if (!activeVizEntry) return;
        targetId = makeLayerId(activeCollection.id, activeSliceIndex, activeVizEntry.vizName);
      }

      lm.setActiveLayer(targetId);
      setActiveLayerId(targetId);

      if (!hasCalledOnReadyRef.current && onReadyRef.current) {
        hasCalledOnReadyRef.current = true;
        lm.onceActiveLayerRendered(() => {
          onReadyRef.current?.();
        });
      }

      // Build UI layer list: one entry per viz (at current collection+slice) + basemaps
      const allLayers = lm.getLayers();
      const basemapLayers = allLayers.filter((l) => l.layerType === 'basemap');
      const seen = new Set<string>();
      const vizLayers = allVizEntries
        .map((v) => {
          const id = makeLayerId(activeCollection.id, activeSliceIndex, v.vizName);
          if (seen.has(id)) return null;
          seen.add(id);
          return allLayers.find((l) => l.id === id) ?? null;
        })
        .filter((l): l is Layer => l !== null);

      const uiLayers = [...vizLayers, ...basemapLayers];
      setLayers(uiLayers);
      onLayersChange?.(uiLayers, targetId);
    },
    [
      campaign,
      activeCollection,
      activeSource,
      activeSliceIndex,
      activeVizEntry,
      allVizEntries,
      showBasemap,
      selectedBasemapId,
      onLayersChange,
    ]
  );

  const syncLayers = useCallback(
    (lm: LayerManager, isViewChange = false) => {
      if (!campaign) return;

      if (isViewChange) {
        lm.getLayers()
          .filter((l) => l.id.startsWith('tile-'))
          .forEach((l) => lm.removeLayer(l.id));
        hasCalledOnReadyRef.current = false;
      }

      const newLayers: XYZLayer[] = [];

      for (const source of campaign.imagery_sources) {
        for (const collection of source.collections) {
          for (let si = 0; si < collection.slices.length; si++) {
            const slice = collection.slices[si];
            for (const tileUrl of slice.tile_urls) {
              const layerId = makeLayerId(collection.id, si, tileUrl.visualization_name);
              if (lm.getLayerById(layerId)) continue;

              const resolvedUrl = buildTileUrl({
                tile_url: tileUrl.tile_url,
                tile_provider: tileUrl.tile_provider,
              });

              newLayers.push(
                new XYZLayer({
                  id: layerId,
                  name: `${source.name} - ${tileUrl.visualization_name}`,
                  layerType: 'imagery',
                  urlTemplate: resolvedUrl,
                  preload: preloadDepth,
                })
              );
            }
          }
        }
      }

      if (newLayers.length > 0) lm.registerLayers(newLayers);
      activateCorrectLayer(lm);
    },
    [campaign, activateCorrectLayer, preloadDepth]
  );

  const initLayers = useCallback(
    (lm: LayerManager) => {
      // Register basemaps from backend
      const basemaps = (campaign?.basemaps ?? []).map(
        (b) =>
          new XYZLayer({
            id: `basemap-${b.id}`,
            name: b.name,
            layerType: 'basemap',
            urlTemplate: b.url,
            attribution: getBasemapAttribution(b.url),
          })
      );
      for (const bm of basemaps) lm.registerLayer(bm);

      const defaultBasemapId = basemaps[0]?.id ?? '';
      if (defaultBasemapId) lm.setActiveLayer(defaultBasemapId);
      const initial = lm.getLayers();
      setLayers(initial);
      setActiveLayerId(defaultBasemapId);
      onLayersChange?.(initial, defaultBasemapId);

      syncLayers(lm);
    },
    [syncLayers, campaign?.basemaps, setLayers, setActiveLayerId, onLayersChange]
  );

  // Re-sync when view changes
  useEffect(() => {
    if (!layerManager || !mapReady || !campaign) return;
    const isViewChange = selectedViewId !== prevViewIdRef.current;
    prevViewIdRef.current = selectedViewId;
    syncLayers(layerManager, isViewChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedViewId, campaign?.id]);

  // Re-activate when selection changes
  useEffect(() => {
    if (!layerManager || !mapReady || !campaign) return;
    activateCorrectLayer(layerManager);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCollectionId,
    activeSliceIndex,
    activeVizEntry?.vizName,
    showBasemap,
    selectedBasemapId,
  ]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      layerManager?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    layers,
    activeLayerId,
    setActiveLayerId,
    initLayers,
  };
}
