/**
 * Fetches custom maps for a campaign, polls while processing,
 * and manages their OL tile layers as map overlays.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import type OLMap from 'ol/Map';
import { listCustomMaps } from '~/api/client';
import type { CustomMapOut } from '~/api/client';
import { getTilerToken } from '~/api/tilerToken';
import { TILER_BASE } from '../utils/tileLoading';

const POLL_INTERVAL_MS = 5_000;

export interface CustomMapState {
  map: CustomMapOut;
  visible: boolean;
  opacity: number;
}

interface UseCustomMapsOptions {
  campaignId: number | null;
  olMapRef: React.RefObject<OLMap | null>;
  mapReady: boolean;
}

export function useCustomMaps({ campaignId, olMapRef, mapReady }: UseCustomMapsOptions) {
  const [maps, setMaps] = useState<CustomMapState[]>([]);
  const layerRefs = useRef<Map<string, TileLayer<XYZ>>>(new Map());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildTileUrl = useCallback((mapId: string, vizParams: Record<string, unknown> | null) => {
    const base = `${TILER_BASE}/api/custom-map/${mapId}/tiles/{z}/{x}/{y}.png`;
    if (!vizParams) return base;

    const params = new URLSearchParams();
    const v = vizParams as Record<string, unknown>;

    // viz_params are stored in snake_case by the backend
    if (Array.isArray(v.assets)) {
      for (const b of v.assets as string[]) params.append('bidx', b);
    }
    if (typeof v.rescale === 'string' && v.rescale) params.append('rescale', v.rescale);
    if (typeof v.colormap_name === 'string' && v.colormap_name)
      params.append('colormap_name', v.colormap_name);
    if (typeof v.color_formula === 'string' && v.color_formula)
      params.append('color_formula', v.color_formula);
    if (typeof v.nodata === 'number') params.append('nodata', String(v.nodata));

    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }, []);

  const createOLLayer = useCallback(
    (mapId: string, vizParams: Record<string, unknown> | null): TileLayer<XYZ> => {
      const urlTemplate = buildTileUrl(mapId, vizParams);
      const source = new XYZ({
        url: urlTemplate,
        crossOrigin: 'anonymous',
        cacheSize: 256,
        tileLoadFunction: (tile, src) => {
          const img = (tile as unknown as { getImage(): HTMLImageElement }).getImage();
          getTilerToken()
            .then((token) => {
              const sep = src.includes('?') ? '&' : '?';
              img.src = `${src}${sep}token=${encodeURIComponent(token)}`;
            })
            .catch(() => {
              img.src = '';
            });
        },
      });
      return new TileLayer({ source, visible: false, opacity: 1, zIndex: 10 });
    },
    [buildTileUrl]
  );

  const syncLayersToMap = useCallback(
    (nextMaps: CustomMapState[]) => {
      const olMap = olMapRef.current;
      if (!olMap) return;

      const readyMaps = nextMaps.filter((s) => s.map.status === 'ready');
      const readyIds = new Set(readyMaps.map((s) => s.map.id));

      // Remove layers for deleted maps
      for (const [id, layer] of layerRefs.current) {
        if (!readyIds.has(id)) {
          olMap.removeLayer(layer);
          layerRefs.current.delete(id);
        }
      }

      // Add/update layers for ready maps
      for (const state of readyMaps) {
        let layer = layerRefs.current.get(state.map.id);
        if (!layer) {
          layer = createOLLayer(state.map.id, state.map.viz_params);
          olMap.addLayer(layer);
          layerRefs.current.set(state.map.id, layer);
        }
        layer.setVisible(state.visible);
        layer.setOpacity(state.opacity);
      }
    },
    [olMapRef, createOLLayer]
  );

  const fetch = useCallback(async () => {
    if (!campaignId) return;
    try {
      const { data: fetched, error } = await listCustomMaps({ path: { campaign_id: campaignId } });
      if (error || !fetched) return;
      setMaps((prev) => {
        const prevById = new Map(prev.map((s) => [s.map.id, s]));
        return fetched.map((m) => {
          const existing = prevById.get(m.id);
          return { map: m, visible: existing?.visible ?? false, opacity: existing?.opacity ?? 1 };
        });
      });
    } catch {
      // silently ignore (network errors during poll)
    }
  }, [campaignId]);

  // Initial fetch + polling while any map is processing
  useEffect(() => {
    if (!campaignId) return;
    fetch();

    const schedule = () => {
      pollTimerRef.current = setTimeout(async () => {
        await fetch();
        // Continue polling as long as any map is in a transient state
        setMaps((current) => {
          if (
            current.some(
              (s) => s.map.status === 'pending_processing' || s.map.status === 'processing'
            )
          ) {
            schedule();
          }
          return current;
        });
      }, POLL_INTERVAL_MS);
    };

    schedule();

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [campaignId, fetch]);

  // Sync OL layers whenever maps or map readiness changes
  useEffect(() => {
    if (mapReady) syncLayersToMap(maps);
  }, [maps, mapReady, syncLayersToMap]);

  // Clean up OL layers on unmount
  useEffect(() => {
    return () => {
      const olMap = olMapRef.current;
      if (olMap) {
        for (const layer of layerRefs.current.values()) {
          olMap.removeLayer(layer);
        }
      }
      layerRefs.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Radio behavior: selecting a map deselects all others; re-clicking hides it
  const toggle = useCallback((mapId: string) => {
    setMaps((prev) => {
      const current = prev.find((s) => s.map.id === mapId);
      const willShow = !current?.visible;
      return prev.map((s) => ({
        ...s,
        visible: s.map.id === mapId ? willShow : false,
      }));
    });
  }, []);

  const setOpacity = useCallback((mapId: string, opacity: number) => {
    setMaps((prev) => prev.map((s) => (s.map.id === mapId ? { ...s, opacity } : s)));
  }, []);

  const refresh = fetch;

  return { maps, toggle, setOpacity, refresh };
}
