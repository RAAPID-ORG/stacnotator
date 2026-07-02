import { describe, expect, it } from 'vitest';
import Feature from 'ol/Feature';
import { Polygon } from 'ol/geom';
import { fromLonLat } from 'ol/proj';

import {
  featureDedupeKey,
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

describe('featureDedupeKey', () => {
  // Two DIFFERENTLY-clipped copies of one cross-tile feature (same id) must
  // collapse to a single key so box-labelling never double-labels it.
  it('dedupes cross-tile copies by feature id regardless of clipped geometry', () => {
    const clipA = new Polygon([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
    ]);
    const clipB = new Polygon([
      [
        [10, 0],
        [20, 0],
        [20, 10],
        [10, 0],
      ],
    ]);
    expect(featureDedupeKey(1, 42, clipA)).toBe(featureDedupeKey(1, 42, clipB));
  });

  it('namespaces ids per layer so equal ids in different layers stay distinct', () => {
    const geom = new Polygon([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ]);
    expect(featureDedupeKey(1, 42, geom)).not.toBe(featureDedupeKey(2, 42, geom));
  });

  it('keeps distinct features with different ids apart', () => {
    const geom = new Polygon([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ]);
    expect(featureDedupeKey(1, 1, geom)).not.toBe(featureDedupeKey(1, 2, geom));
  });

  it('falls back to a geometry key when the source has no feature ids', () => {
    const a = new Polygon([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
    ]);
    const b = new Polygon([
      [
        [100, 100],
        [110, 100],
        [110, 110],
        [100, 100],
      ],
    ]);
    const keyA = featureDedupeKey(1, undefined, a);
    expect(keyA).toBe(featureDedupeKey(1, undefined, a.clone())); // same shape → same key
    expect(keyA).not.toBe(featureDedupeKey(1, undefined, b)); // different shape → different key
    expect(keyA).toContain('geom'); // used the fallback, not an id
  });
});
