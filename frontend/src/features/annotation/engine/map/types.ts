export type LayerId = string;
export type LonLat = [number, number];
export type Bbox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

export interface StyleSpec {
  stroke?: { color: string; width: number; dash?: number[] };
  fill?: { color: string };
  circle?: { radius: number; stroke?: { color: string; width: number }; fill?: { color: string } };
  /** Two crossing lines spanning `size` pixels, centred on the point. */
  cross?: { size: number; stroke: { color: string; width: number } };
  text?: { label: string; color: string; haloColor?: string };
}

export interface RasterLayerSpec {
  kind: 'raster';
  id: LayerId;
  url: string; // XYZ template; '{q}' means Bing quadkey
  auth?: 'cookie' | 'none'; // cookie => credentialed loader + tiler token refresh
  opacity?: number;
  zIndex?: number;
  visible?: boolean;
  attribution?: string;
  minZoom?: number;
  maxZoom?: number; // basemap max_native_zoom
  preload?: number; // OL preload depth; default 0
  /** Changes when cached tile/error state must not cross a navigation boundary. */
  cacheScope?: string;
}

export interface VectorTileLayerSpec {
  kind: 'vector-tiles';
  id: LayerId;
  url: string; // pmtiles:// or mvt template
  /** Called per feature per frame: keep it cheap and return few distinct specs. */
  style: StyleSpec | ((featureProps: Record<string, unknown>) => StyleSpec | null);
  zIndex?: number;
  visible?: boolean;
  minZoom?: number; // annotation tiles use ANNOTATION_TILE_MIN_ZOOM - 1
  idProperty?: string; // MVT property promoted to feature id (e.g. 'annotation_id');
  // hidden/highlight matching AND hit-testing resolve through it
  sourceLayers?: string[]; // MVT layers filter (PMTiles source_layer restriction)
  hiddenFeatureIds?: Array<string | number>; // rendered fully transparent (editing)
  highlightFeatureIds?: Array<string | number>;
}

export interface GeoFeature {
  id?: string | number;
  geometry: GeoJSON.Geometry; // EPSG:4326 always at this boundary
  properties?: Record<string, unknown>;
}

export interface FeatureLayerSpec {
  kind: 'features';
  id: LayerId;
  features: GeoFeature[];
  /** Called per feature per frame: keep it cheap and return few distinct specs. */
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
