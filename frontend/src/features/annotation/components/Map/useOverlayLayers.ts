import { useEffect } from 'react';
import OLMap from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { TILER_BASE, tileLoadImagery } from '../../utils/tileLoading';
import { useOverlayStore } from '../../stores/overlay.store';

const OVERLAY_Z_INDEX = 50;
const POLL_INTERVAL_MS = 3000;
const PROP_CUSTOM_MAP_ID = 'customMapId';

export function useOverlayLayers(map: OLMap | null, campaignId: number | null) {
  const customMaps = useOverlayStore((s) => s.customMaps);
  const activeId = useOverlayStore((s) => s.activeId);
  const load = useOverlayStore((s) => s.load);
  const refresh = useOverlayStore((s) => s.refresh);

  useEffect(() => {
    if (campaignId == null) return;
    load(campaignId);
  }, [campaignId, load]);

  useEffect(() => {
    const hasInflight = customMaps.some((m) => m.status === 'pending' || m.status === 'processing');
    if (!hasInflight) return;
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [customMaps, refresh]);

  useEffect(() => {
    if (!map) return;

    const existing = new Map<string, TileLayer<XYZ>>();
    map
      .getLayers()
      .getArray()
      .forEach((l) => {
        const id = l.get(PROP_CUSTOM_MAP_ID);
        if (id) existing.set(id, l as TileLayer<XYZ>);
      });

    const active = activeId
      ? customMaps.find((m) => m.id === activeId && m.status === 'ready' && m.tile_url_template)
      : null;

    if (active && !existing.has(active.id)) {
      const layer = new TileLayer({
        source: new XYZ({
          url: `${TILER_BASE}${active.tile_url_template}`,
          crossOrigin: 'anonymous',
          cacheSize: 512,
          tileLoadFunction: tileLoadImagery as unknown as (tile: unknown, src: string) => void,
        }),
        zIndex: OVERLAY_Z_INDEX,
      });
      layer.set(PROP_CUSTOM_MAP_ID, active.id);
      layer.set('layerId', `overlay-${active.id}`);
      map.addLayer(layer);
    }

    for (const [id, layer] of existing) {
      if (id !== active?.id) map.removeLayer(layer);
    }
  }, [map, customMaps, activeId]);

  useEffect(() => {
    return () => {
      if (!map) return;
      const toRemove: TileLayer<XYZ>[] = [];
      map
        .getLayers()
        .getArray()
        .forEach((l) => {
          if (l.get(PROP_CUSTOM_MAP_ID)) toRemove.push(l as TileLayer<XYZ>);
        });
      toRemove.forEach((l) => map.removeLayer(l));
    };
  }, [map]);
}
