import { describe, expect, it } from 'vitest';
import Feature from 'ol/Feature';
import { Polygon } from 'ol/geom';
import { fromLonLat } from 'ol/proj';

import {
  featureLikeToGeometry,
  featureLikeToGeoJSON4326,
  olGeometryToGeoJSON4326,
} from './vectorFeatureGeometry';

// A small square around (10, 50) lon/lat, expressed in EPSG:3857 (map coords).
function squareInMercator(): Polygon {
  const ring = [
    fromLonLat([10, 50]),
    fromLonLat([10.001, 50]),
    fromLonLat([10.001, 50.001]),
    fromLonLat([10, 50.001]),
    fromLonLat([10, 50]),
  ];
  return new Polygon([ring]);
}

describe('vectorFeatureGeometry', () => {
  it('serializes an OL geometry (3857) to GeoJSON in 4326', () => {
    const gj = olGeometryToGeoJSON4326(squareInMercator());
    expect(gj?.type).toBe('Polygon');
    const [lon, lat] = (gj as GeoJSON.Polygon).coordinates[0][0];
    expect(lon).toBeCloseTo(10, 5);
    expect(lat).toBeCloseTo(50, 5);
  });

  it('clones the geometry from a real ol/Feature', () => {
    const geom = squareInMercator();
    const feature = new Feature({ geometry: geom });
    const cloned = featureLikeToGeometry(feature);
    expect(cloned).toBeInstanceOf(Polygon);
    expect(cloned).not.toBe(geom); // it is a clone, not the same instance
    expect(cloned?.getExtent()).toEqual(geom.getExtent());
  });

  it('round-trips a feature into a 4326 GeoJSON polygon', () => {
    const feature = new Feature({ geometry: squareInMercator() });
    const gj = featureLikeToGeoJSON4326(feature);
    expect(gj?.type).toBe('Polygon');
    const ring = (gj as GeoJSON.Polygon).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0][0]).toBeCloseTo(10, 5);
    expect(ring[0][1]).toBeCloseTo(50, 5);
  });
});
