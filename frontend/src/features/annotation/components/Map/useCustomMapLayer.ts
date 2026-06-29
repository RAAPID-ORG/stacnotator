import { useEffect } from 'react';
import { XYZLayer } from './Layer';
import type { LayerManager } from './layerManager';
import type { CustomMapOut } from '~/api/client';
import { useMapStore } from '../../stores/map.store';

export function useCustomMapLayer(lm: LayerManager | null, customMaps: CustomMapOut[]) {
  const activeId = useMapStore((s) => s.activeCustomMapId);
  const opacity = useMapStore((s) => s.customMapOpacity);
  const show = useMapStore((s) => s.showCustomMap);

  useEffect(() => {
    if (!lm) return;
    const cm = customMaps.find((m) => m.id === activeId && m.status === 'ready' && m.tile_url);
    if (!cm) {
      lm.setOverlayLayer(null);
      return;
    }
    lm.setOverlayLayer(
      new XYZLayer({
        id: `custom-map-${cm.id}`,
        name: cm.name,
        layerType: 'overlay',
        urlTemplate: cm.tile_url!,
        crossOrigin: 'use-credentials',
        maxZoom: cm.max_native_zoom ?? undefined,
        opacity: opacity / 100,
      })
    );
  }, [lm, customMaps, activeId, opacity]);

  useEffect(() => {
    lm?.setOverlayVisible(show);
  }, [lm, show]);

  useEffect(() => {
    lm?.setOverlayOpacity(opacity / 100);
  }, [lm, opacity]);
}
