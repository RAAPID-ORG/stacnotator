import type { Bbox, GeoFeature, LayerId, StyleSpec } from '../types';

export type DrawShape = 'Point' | 'LineString' | 'Polygon';

/** One feature a box gesture caught, with the layer it came from - vector-tile
 *  feature ids are only unique within their own layer, so a caller that
 *  de-duplicates a feature spanning several tiles needs both. */
export interface BoxHit {
  layerId: LayerId;
  feature: GeoFeature;
}

export interface InteractionSpec {
  draw?: { shape: DrawShape; onDrawEnd: (g: GeoJSON.Geometry) => void; sketchStyle?: StyleSpec };
  edit?: {
    feature: GeoFeature;
    onGeometryChange: (g: GeoJSON.Geometry) => void; // fires on modify/translate end
    style?: StyleSpec;
  };
  boxSelect?: {
    // Shift+drag. `hits` holds the features of `hitLayerIds` inside the box,
    // empty when no layers were named - labelling vector features by box needs
    // their geometry, and nothing outside this module can read a rendered
    // vector tile.
    onBox: (bbox: Bbox, hits: BoxHit[]) => void;
    hitLayerIds?: LayerId[];
  };
  snap?: boolean;
}
