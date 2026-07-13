/**
 * useVectorLayers — mounts user-provided PMTiles vector layers on the map.
 *
 * Each enabled `VectorLayer` becomes an OL `VectorTileLayer` backed by a
 * `PMTilesVectorSource` (ol-pmtiles reads the `.pmtiles` file directly via HTTP
 * range requests — no tiler involved). One layer is active at a time; mounted
 * layers are keyed by id and reconciled against it. Styling is a stroke+fill
 * derived from the layer's colour. Hit-testing and hover/label interactions live
 * in `VectorLabelLayer`, targeting these layers via the `VECTOR_LAYER_FLAG`.
 */
import { useEffect, useRef } from 'react';
import type OLMap from 'ol/Map';
import { MVT } from 'ol/format';
import VectorTileLayer from 'ol/layer/VectorTile';
import { Fill, Stroke, Style } from 'ol/style';
import { PMTilesVectorSource } from 'ol-pmtiles';

import type { VectorLayerOut } from '~/api/client';
import {
  hexToRgba,
  VECTOR_LAYER_FLAG,
  VECTOR_LAYER_ID_PROP,
  VECTOR_LAYER_Z_INDEX,
} from './mapUtils';

/** Signature of a layer's render-affecting fields; a change forces a rebuild. */
function layerSignature(layer: VectorLayerOut): string {
  return `${layer.pmtiles_url}|${layer.color}|${layer.source_layer ?? ''}`;
}

function buildVectorLayer(layer: VectorLayerOut): VectorTileLayer {
  const source = new PMTilesVectorSource({
    url: layer.pmtiles_url,
    format: new MVT({
      layers: layer.source_layer ? [layer.source_layer] : undefined,
    }),
  });
  const olLayer = new VectorTileLayer({
    source,
    declutter: false,
    zIndex: VECTOR_LAYER_Z_INDEX,
    style: new Style({
      stroke: new Stroke({ color: hexToRgba(layer.color, 0.95), width: 1.5 }),
      fill: new Fill({ color: hexToRgba(layer.color, 0.12) }),
    }),
  });
  olLayer.set(VECTOR_LAYER_FLAG, true);
  olLayer.set(VECTOR_LAYER_ID_PROP, layer.id);
  return olLayer;
}

export function useVectorLayers(
  map: OLMap | null,
  vectorLayers: VectorLayerOut[],
  activeId: number | null
) {
  // id -> { layer, signature } for reconciliation across renders.
  const mountedRef = useRef<Map<number, { layer: VectorTileLayer; signature: string }>>(new Map());

  useEffect(() => {
    if (!map) return;
    const mounted = mountedRef.current;
    const byId = new Map(vectorLayers.map((l) => [l.id, l]));
    const enabled = new Set(activeId != null && byId.has(activeId) ? [activeId] : []);

    // Remove layers that are no longer enabled or whose definition changed.
    for (const [id, entry] of [...mounted]) {
      const def = byId.get(id);
      const stale = !enabled.has(id) || !def || layerSignature(def) !== entry.signature;
      if (stale) {
        map.removeLayer(entry.layer);
        entry.layer.getSource()?.clear();
        mounted.delete(id);
      }
    }

    // Add newly enabled (or rebuilt) layers.
    for (const id of enabled) {
      if (mounted.has(id)) continue;
      const def = byId.get(id)!;
      const layer = buildVectorLayer(def);
      map.addLayer(layer);
      mounted.set(id, { layer, signature: layerSignature(def) });
    }
  }, [map, vectorLayers, activeId]);

  // Tear everything down on unmount. mountedRef holds a single stable Map object
  // for the lifetime of the hook, so capturing it here is safe.
  useEffect(() => {
    const mounted = mountedRef.current;
    return () => {
      if (!map) return;
      for (const { layer } of mounted.values()) {
        map.removeLayer(layer);
      }
      mounted.clear();
    };
  }, [map]);
}
