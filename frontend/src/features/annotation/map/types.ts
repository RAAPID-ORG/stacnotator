import type { StyleSpec } from '../campaign/labelStyle';

export type { StyleSpec };
export type LayerId = string;
export type LonLat = [number, number];
export type Bbox = [number, number, number, number];

export interface GeoFeature {
  id?: string | number;
  /** EPSG:4326 always at this boundary. */
  geometry: GeoJSON.Geometry;
  properties?: Record<string, unknown>;
}

export interface RasterLayerSpec {
  kind: 'raster';
  id: LayerId;
  /** XYZ template; '{q}' means a Bing quadkey. */
  url: string;
  /** 'cookie' uses a credentialed loader and refreshes the tiler token. */
  auth?: 'cookie' | 'none';
  opacity?: number;
  zIndex?: number;
  visible?: boolean;
  attribution?: string;
  minZoom?: number;
  maxZoom?: number;
  /** OL preload depth. */
  preload?: number;
  /** Changes when cached tile state must not cross a navigation boundary. */
  cacheScope?: string;
}

export interface VectorTileLayerSpec {
  kind: 'vector-tiles';
  id: LayerId;
  /** `pmtiles://` or an MVT template. */
  url: string;
  /** Called per feature per frame: keep it cheap and return few distinct specs. */
  style: StyleSpec | ((featureProps: Record<string, unknown>) => StyleSpec | null);
  zIndex?: number;
  visible?: boolean;
  minZoom?: number;
  /** MVT property promoted to the feature id. Hiding, highlighting and
   *  hit-testing all resolve through it. */
  idProperty?: string;
  sourceLayers?: string[];
  /** Rendered fully transparent, e.g. while being edited. */
  hiddenFeatureIds?: Array<string | number>;
  highlightFeatureIds?: Array<string | number>;
}

export interface FeatureLayerSpec {
  kind: 'features';
  id: LayerId;
  features: GeoFeature[];
  style: StyleSpec | ((f: GeoFeature) => StyleSpec);
  zIndex?: number;
  visible?: boolean;
}

export type LayerSpec = RasterLayerSpec | VectorTileLayerSpec | FeatureLayerSpec;

export interface CameraState {
  center: LonLat;
  zoom: number;
}

export interface CameraSnapshot extends CameraState {
  bounds: Bbox;
}

export type DrawShape = 'Point' | 'LineString' | 'Polygon';

/** One feature a box gesture caught. Vector-tile ids are only unique within
 *  their layer, so a caller de-duplicating across tiles needs both. */
export interface BoxHit {
  layerId: LayerId;
  feature: GeoFeature;
}

export interface InteractionSpec {
  draw?: { shape: DrawShape; onDrawEnd: (g: GeoJSON.Geometry) => void; sketchStyle?: StyleSpec };
  edit?: {
    feature: GeoFeature;
    /** Fires on modify/translate end. */
    onGeometryChange: (g: GeoJSON.Geometry) => void;
    style?: StyleSpec;
  };
  boxSelect?: {
    /** Shift+drag. `hits` holds the features of `hitLayerIds` inside the box,
     *  empty when no layers were named - nothing outside this module can read
     *  a rendered vector tile. */
    onBox: (bbox: Bbox, hits: BoxHit[]) => void;
    hitLayerIds?: LayerId[];
  };
  snap?: boolean;
}

export interface MapClickEvent {
  lonLat: LonLat;
  layerId?: LayerId;
  featureId?: string | number;
  featureProps?: Record<string, unknown>;
  /** The hit feature's own geometry. Labelling a vector feature turns exactly
   *  this into an annotation. */
  featureGeometry?: GeoJSON.Geometry;
  shiftKey: boolean;
}
