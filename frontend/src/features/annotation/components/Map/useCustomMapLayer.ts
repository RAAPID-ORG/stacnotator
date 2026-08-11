import { useEffect, useRef } from 'react';
import { XYZLayer } from './Layer';
import type { LayerManager } from './layerManager';
import type { CustomMapOut } from '~/api/client';
import { useMapStore } from '../../stores/map.store';
import { usePreferencesStore } from '../../stores/preferences.store';
import { applyRenderOverride } from '../../utils/customMapOverride';

export function useCustomMapLayer(lm: LayerManager | null, customMaps: CustomMapOut[]) {
  const activeId = useMapStore((s) => s.activeCustomMapId);
  const opacity = useMapStore((s) => s.customMapOpacity);
  const show = useMapStore((s) => s.showCustomMap);
  const overrides = usePreferencesStore((s) => s.customMapOverrides);
  /** Last URL each layer id was built from. A `Layer` is immutable and the manager keys on
   *  id alone, so a changed URL needs the stale layer dropped before it will take effect. */
  const builtUrls = useRef(new Map<string, string>());

  useEffect(() => {
    if (!lm) return;
    const cm = customMaps.find((m) => m.id === activeId && m.status === 'ready' && m.tile_url);
    if (!cm) {
      lm.setOverlayLayer(null);
      return;
    }
    const id = `custom-map-${cm.id}`;
    const url = applyRenderOverride(cm.tile_url!, cm.render_config, overrides[cm.id]);
    if (builtUrls.current.get(id) !== url) {
      lm.removeLayer(id);
      builtUrls.current.set(id, url);
    }
    lm.setOverlayLayer(
      new XYZLayer({
        id,
        name: cm.name,
        layerType: 'overlay',
        urlTemplate: url,
        crossOrigin: 'use-credentials',
        maxZoom: cm.max_native_zoom ?? undefined,
      })
    );
    // Re-applied here rather than in their own effects: setOverlayLayer always reveals the
    // layer at full opacity, so a rebuilt layer would otherwise drop the user's settings.
    lm.setOverlayOpacity(opacity / 100);
    lm.setOverlayVisible(show);
  }, [lm, customMaps, activeId, overrides, opacity, show]);
}
