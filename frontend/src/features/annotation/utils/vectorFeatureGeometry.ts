/**
 * Helpers for turning features read from PMTiles vector-tile layers into the
 * geometry shapes the annotation pipeline expects.
 *
 * Vector-tile layers yield lightweight `RenderFeature`s (MVT default); these
 * helpers normalise both `RenderFeature` and full `ol/Feature` into an OL
 * `Geometry` (map projection, EPSG:3857) for highlighting, and into a GeoJSON
 * geometry (EPSG:4326) for annotation submission — the exact same 3857→4326
 * serialization drawn annotations use.
 */
import type { FeatureLike } from 'ol/Feature';
import Feature from 'ol/Feature';
import { GeoJSON as OLGeoJSON } from 'ol/format';
import type { Geometry } from 'ol/geom';
import RenderFeature, { toGeometry } from 'ol/render/Feature';

const geoJsonFormat = new OLGeoJSON();

/** Extract a cloned OL geometry (map projection) from a feature or render-feature. */
export function featureLikeToGeometry(feature: FeatureLike): Geometry | null {
  if (feature instanceof RenderFeature) {
    // toGeometry builds a real geometry from the render feature's flat coords.
    return toGeometry(feature) as Geometry;
  }
  if (feature instanceof Feature) {
    return feature.getGeometry()?.clone() ?? null;
  }
  return null;
}

/** Serialize an OL geometry (EPSG:3857) to a GeoJSON geometry (EPSG:4326). */
export function olGeometryToGeoJSON4326(geometry: Geometry): GeoJSON.Geometry | null {
  try {
    const gj = geoJsonFormat.writeGeometryObject(geometry, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:4326',
    });
    return (gj as GeoJSON.Geometry) ?? null;
  } catch {
    return null;
  }
}

/** Convenience: feature/render-feature → GeoJSON geometry (EPSG:4326). */
export function featureLikeToGeoJSON4326(feature: FeatureLike): GeoJSON.Geometry | null {
  const geom = featureLikeToGeometry(feature);
  return geom ? olGeometryToGeoJSON4326(geom) : null;
}
