/**
 * VectorLabelLayer
 *
 * Owns the interactions that sit on top of the PMTiles vector layers mounted by
 * `useVectorLayers`:
 *   - Hover highlight: while a vector layer is enabled (pan / label-vector tool),
 *     the feature under the cursor is outlined in a dedicated highlight overlay.
 *   - Label-vector tool: with a label selected, clicking a vector feature creates
 *     an annotation from its geometry; Shift+drag box-selects every vector feature
 *     in the box and labels them all at once. No drawing required.
 *
 * Geometry flows through the same 3857→4326 → WKT path as drawn annotations, so
 * labelled vector features are ordinary annotations from the backend's view.
 */
import { memo, useEffect, useRef } from 'react';
import type { FeatureLike } from 'ol/Feature';
import Feature from 'ol/Feature';
import type OLMap from 'ol/Map';
import { DragBox } from 'ol/interaction';
import { shiftKeyOnly } from 'ol/events/condition';
import type { Geometry } from 'ol/geom';
import VectorLayer from 'ol/layer/Vector';
import type VectorTileLayer from 'ol/layer/VectorTile';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';

import type { ExtendedLabel } from '../../utils/labelMetadata';
import { useAnnotationStore } from '../../stores/annotation.store';
import { useTaskStore } from '../../stores/task.store';
import type { AnnotationTool } from '../../stores/map.store';
import { handleError } from '~/shared/utils/errorHandler';
import {
  featureDedupeKey,
  featureLikeToGeoJSON4326,
  featureLikeToGeometry,
  olGeometryToGeoJSON4326,
} from '../../utils/vectorFeatureGeometry';
import { VECTOR_HIGHLIGHT_Z_INDEX, VECTOR_LAYER_FLAG, VECTOR_LAYER_ID_PROP } from './mapUtils';

const HIT_TOLERANCE = 3;

const HIGHLIGHT_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(255,255,255,0.95)', width: 3 }),
  fill: new Fill({ color: 'rgba(255,255,255,0.25)' }),
});

export interface VectorLabelLayerProps {
  map: OLMap;
  activeTool: AnnotationTool;
  selectedLabel: ExtendedLabel | null;
  hasEnabledLayers: boolean;
}

const VectorLabelLayer = ({
  map,
  activeTool,
  selectedLabel,
  hasEnabledLayers,
}: VectorLabelLayerProps) => {
  const saveAnnotation = useAnnotationStore((s) => s.saveAnnotation);
  const saveAnnotationsBatch = useAnnotationStore((s) => s.saveAnnotationsBatch);

  const highlightSourceRef = useRef<VectorSource<Feature<Geometry>> | null>(null);
  const selectedLabelRef = useRef(selectedLabel);
  selectedLabelRef.current = selectedLabel;

  // Highlight overlay layer (created once).
  useEffect(() => {
    const source = new VectorSource<Feature<Geometry>>();
    const layer = new VectorLayer({
      source,
      zIndex: VECTOR_HIGHLIGHT_Z_INDEX,
      style: HIGHLIGHT_STYLE,
    });
    highlightSourceRef.current = source;
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
      highlightSourceRef.current = null;
    };
  }, [map]);

  const hitVectorFeature = (pixel: number[]): FeatureLike | null =>
    map.forEachFeatureAtPixel(pixel, (f) => f, {
      layerFilter: (l) => l.get(VECTOR_LAYER_FLAG) === true,
      hitTolerance: HIT_TOLERANCE,
    }) ?? null;

  // Hover highlight — active when a vector layer is on and we're in a tool that
  // doesn't already own the pointer (pan / label-vector).
  const hoverActive = hasEnabledLayers && (activeTool === 'pan' || activeTool === 'labelvector');

  useEffect(() => {
    const source = highlightSourceRef.current;
    if (!source) return;
    if (!hoverActive) {
      source.clear();
      return;
    }

    const onPointerMove = (evt: { dragging: boolean; pixel: number[] }) => {
      if (evt.dragging) return;
      const hit = hitVectorFeature(evt.pixel);
      source.clear();
      if (hit) {
        const geom = featureLikeToGeometry(hit);
        if (geom) source.addFeature(new Feature({ geometry: geom }));
      }
      if (activeTool === 'labelvector') {
        map.getTargetElement()?.style.setProperty('cursor', hit ? 'pointer' : '');
      }
    };

    map.on('pointermove', onPointerMove as unknown as () => void);
    return () => {
      map.un('pointermove', onPointerMove as unknown as () => void);
      source.clear();
      map.getTargetElement()?.style.setProperty('cursor', '');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, hoverActive, activeTool]);

  // Label-vector interactions: click to label one, Shift+drag to label many.
  useEffect(() => {
    if (activeTool !== 'labelvector' || !hasEnabledLayers) return;

    const onClick = (evt: { pixel: number[]; originalEvent: MouseEvent }) => {
      if (evt.originalEvent.shiftKey) return;
      const label = selectedLabelRef.current;
      if (!label) return;
      const hit = hitVectorFeature(evt.pixel);
      if (!hit) return;
      const geoJSON = featureLikeToGeoJSON4326(hit);
      if (geoJSON) {
        void saveAnnotation(geoJSON, label.id, undefined, useTaskStore.getState().formValues);
      }
    };
    map.on('click', onClick as unknown as () => void);

    const dragBox = new DragBox({ condition: shiftKeyOnly });
    dragBox.on('boxend', () => {
      const label = selectedLabelRef.current;
      if (!label) return;
      const extent = dragBox.getGeometry().getExtent();
      const layers = map
        .getLayers()
        .getArray()
        .filter((l) => l.get(VECTOR_LAYER_FLAG) === true) as VectorTileLayer[];

      const seen = new Set<string>();
      const geometries: GeoJSON.Geometry[] = [];
      for (const layer of layers) {
        const layerId = layer.get(VECTOR_LAYER_ID_PROP);
        for (const feature of layer.getFeaturesInExtent(extent)) {
          const geom = featureLikeToGeometry(feature as FeatureLike);
          if (!geom || !geom.intersectsExtent(extent)) continue;
          const key = featureDedupeKey(layerId, (feature as FeatureLike).getId(), geom);
          if (seen.has(key)) continue;
          seen.add(key);
          const geoJSON = olGeometryToGeoJSON4326(geom);
          if (geoJSON) geometries.push(geoJSON);
        }
      }
      if (geometries.length === 0) return;
      void saveAnnotationsBatch(geometries, label.id, useTaskStore.getState().formValues).catch(
        (err) => handleError(err, 'Failed to label features')
      );
    });
    map.addInteraction(dragBox);

    return () => {
      map.un('click', onClick as unknown as () => void);
      map.removeInteraction(dragBox);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activeTool, hasEnabledLayers]);

  return null;
};

export default memo(VectorLabelLayer);
