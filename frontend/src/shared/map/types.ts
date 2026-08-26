/** Paint description the map layer translates into an OpenLayers style. */
export interface StyleSpec {
  stroke?: { color: string; width: number; dash?: number[] };
  fill?: { color: string };
  circle?: { radius: number; stroke?: { color: string; width: number }; fill?: { color: string } };
  /** Two crossing lines spanning `size` pixels, centred on the point. */
  cross?: { size: number; stroke: { color: string; width: number } };
  text?: { label: string; color: string; haloColor?: string };
}

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
  /** 'bearer' loads the tiles like the API client does. Our own MVT endpoints
   *  need it; PMTiles in storage do not. */
  auth?: 'bearer' | 'none';
  /** Called per feature per frame: keep it cheap and return few distinct specs. */
  style: StyleSpec | ((featureProps: Record<string, unknown>) => StyleSpec | null);
  opacity?: number;
  zIndex?: number;
  visible?: boolean;
  minZoom?: number;
  /** OL preload depth: how many lower-resolution levels are fetched ahead, so
   *  zooming out lands on tiles that are already there. */
  preload?: number;
  /** MVT property promoted to the feature id. Hiding, highlighting and
   *  hit-testing all resolve through it. */
  idProperty?: string;
  sourceLayers?: string[];
  /** Rendered fully transparent, e.g. while being edited, or while an overlay
   *  is drawing that feature instead. Sets, because the style callback tests
   *  membership per feature per frame. */
  hiddenFeatureIds?: ReadonlySet<string | number>;
  highlightFeatureIds?: ReadonlySet<string | number>;
}

export interface FeatureLayerSpec {
  kind: 'features';
  id: LayerId;
  features: GeoFeature[];
  style: StyleSpec | ((f: GeoFeature) => StyleSpec);
  zIndex?: number;
  visible?: boolean;
  minZoom?: number;
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
    /** `hits` holds the features of `hitLayerIds` inside the box, empty when no
     *  layers were named - nothing outside this module can read a rendered
     *  vector tile. */
    onBox: (bbox: Bbox, hits: BoxHit[]) => void;
    hitLayerIds?: LayerId[];
    /** Shift+drag by default, so a box never competes with panning. A page in a
     *  mode where drawing a box IS the gesture asks for 'always'. */
    condition?: 'shift' | 'always';
  };
  snap?: boolean;
}

/** How much a stroke thickens when a feature is selected, or merely hovered.
 *  Shared so one annotation looks the same whether it reached the map as a
 *  vector tile or as a live delta feature - they used to differ by 3px against
 *  1px, which read as "some polygons have fat borders". */
export const SELECTED_EXTRA_WIDTH = 1;
export const HOVERED_EXTRA_WIDTH = 0.5;

/** Point radius by emphasis, matching the stroke steps above. */
export const POINT_RADIUS = { plain: 6, hovered: 7, selected: 8 } as const;

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
