/**
 * useOLMap – React hook that owns the OpenLayers Map instance lifecycle.
 *
 * Responsibilities:
 *  - Create & destroy the OL Map
 *  - Manage one TileLayer per LayerDef in the map store
 *  - Show/hide layers based on activeLayerId
 *  - Activate STAC layers (registration + URL patch) lazily when selected
 *  - Sync OL view changes back to the map store (setViewState – no animation)
 *  - Respond to explicit flyTo commands from the map store (flyToTarget)
 *  - Place a crosshair overlay at the map center
 *
 * Loop-prevention
 * ───────────────
 * `setViewState` updates `center`/`zoom` in the store from OL's `moveend`.
 * `flyTo` updates `flyToTarget` (a separate signal with a `seq` counter).
 * The animation effect watches ONLY `flyToTarget.seq`, so a user pan that
 * calls `setViewState` never triggers the animation, breaking the cycle.
 */

import { useEffect, useRef } from 'react';
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import 'ol/ol.css';

import {
  type StacLayerDef,
  createXYZTileLayer,
  createStacTileLayer,
  activateStacLayer,
} from './layers';
import { useMapStore } from './map.store';
import { createCrosshairOverlay } from '../components/Map/Crosshair';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOLMap(containerRef: React.RefObject<HTMLDivElement | null>) {
  const mapRef = useRef<OLMap | null>(null);

  // layerId → OL TileLayer, kept in sync with the store's availableLayers
  const olLayersRef = useRef<Map<string, TileLayer<XYZ>>>(new Map());

  // STAC layers whose registration request has been fired
  const activatedStacIds = useRef<Set<string>>(new Set());

  // ── 1. Create the OL map once ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const { center, zoom } = useMapStore.getState();
    const crosshair = createCrosshairOverlay('ffffff');

    const map = new OLMap({
      target: containerRef.current,
      layers: [],
      overlays: [crosshair.overlay],
      view: new View({
        center: fromLonLat(center),
        zoom,
      }),
      controls: [],
    });

    // Crosshair always at map center
    const updateCrosshair = () => crosshair.updatePosition(map);
    map.on('moveend', updateCrosshair);
    updateCrosshair();

    // Sync OL view → store after user pan/zoom.
    // This calls setViewState which updates center/zoom only – it does NOT
    // set flyToTarget, so the animation subscriber below is never triggered.
    map.on('moveend', () => {
      const view = map.getView();
      const olCenter = view.getCenter();
      if (!olCenter) return;
      const lonLat = toLonLat(olCenter) as [number, number];
      useMapStore.getState().setViewState(lonLat, view.getZoom() ?? 10);
    });

    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once
  }, [containerRef]);

  // ── 2. Layer sync & STAC activation ─────────────────────────────────────
  useEffect(() => {
    return useMapStore.subscribe((state) => {
      const map = mapRef.current;
      if (!map) return;

      const { availableLayers, activeLayerId } = state;

      // Add any new layers to the OL map
      for (const def of availableLayers) {
        if (!olLayersRef.current.has(def.id)) {
          const olLayer =
            def.kind === 'xyz'
              ? createXYZTileLayer(def)
              : createStacTileLayer(def as StacLayerDef);
          map.addLayer(olLayer);
          olLayersRef.current.set(def.id, olLayer);
        }
      }

      // Toggle visibility – only the active layer is shown
      for (const [id, olLayer] of olLayersRef.current) {
        const isActive = id === activeLayerId;
        olLayer.setVisible(isActive);

        // Fire STAC registration lazily on first activation
        if (isActive && !activatedStacIds.current.has(id)) {
          const def = availableLayers.find((l) => l.id === id);
          if (def?.kind === 'stac') {
            activatedStacIds.current.add(id);
            activateStacLayer(olLayer, def as StacLayerDef).catch(console.error);
          }
        }
      }
    });
  }, []);

  // ── 3. Animate to flyToTarget (only reacts to explicit flyTo commands) ───
  //
  // We track the last seq we acted on. The subscriber fires on every store
  // change, but we only animate when flyToTarget.seq has incremented.
  // `setViewState` never touches flyToTarget, so user panning is safe.
  useEffect(() => {
    let lastSeq = useMapStore.getState().flyToTarget?.seq ?? -1;

    return useMapStore.subscribe((state) => {
      const target = state.flyToTarget;
      if (!target || target.seq === lastSeq) return;

      const map = mapRef.current;
      if (!map) return;

      lastSeq = target.seq;
      map.getView().animate({
        center: fromLonLat(target.center),
        zoom: target.zoom,
        duration: 300,
      });
    });
  }, []);

  return mapRef;
}
