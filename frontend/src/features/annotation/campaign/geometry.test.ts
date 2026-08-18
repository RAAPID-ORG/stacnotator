import { describe, expect, it } from 'vitest';
import { featureDedupeKey, geometryCentroid, geometryToWkt, wktToGeometry } from './annotation';

function polygon(ring: [number, number][]): GeoJSON.Polygon {
  return { type: 'Polygon', coordinates: [ring] };
}

describe('featureDedupeKey', () => {
  // Two DIFFERENTLY-clipped copies of one cross-tile feature (same id) must
  // collapse to a single key so box-labelling never double-labels it.
  it('dedupes cross-tile copies by feature id regardless of clipped geometry', () => {
    const clipA = polygon([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 0],
    ]);
    const clipB = polygon([
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 0],
    ]);
    expect(featureDedupeKey(1, 42, clipA)).toBe(featureDedupeKey(1, 42, clipB));
  });

  it('namespaces ids per layer so equal ids in different layers stay distinct', () => {
    const geom = polygon([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
    expect(featureDedupeKey(1, 42, geom)).not.toBe(featureDedupeKey(2, 42, geom));
  });

  it('keeps distinct features with different ids apart', () => {
    const geom = polygon([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
    expect(featureDedupeKey(1, 1, geom)).not.toBe(featureDedupeKey(1, 2, geom));
  });

  it('falls back to a geometry key when the source has no feature ids', () => {
    const a = polygon([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 0],
    ]);
    const aClone = polygon([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 0],
    ]);
    const b = polygon([
      [100, 100],
      [110, 100],
      [110, 110],
      [100, 100],
    ]);
    const keyA = featureDedupeKey(1, undefined, a);
    expect(keyA).toBe(featureDedupeKey(1, undefined, aClone)); // same shape -> same key
    expect(keyA).not.toBe(featureDedupeKey(1, undefined, b)); // different shape -> different key
    expect(keyA).toContain('geom'); // used the fallback, not an id
  });

  it('computes the extent across a multi-ring / multi-point geometry', () => {
    const point: GeoJSON.Point = { type: 'Point', coordinates: [5, 5] };
    expect(featureDedupeKey(1, undefined, point)).toBe('1:geom:Point:5,5,5,5');
  });
});

describe('geometryToWkt', () => {
  it('formats a Point', () => {
    const point: GeoJSON.Point = { type: 'Point', coordinates: [1, 2] };
    expect(geometryToWkt(point)).toBe('POINT (1 2)');
  });

  it('formats a LineString', () => {
    const line: GeoJSON.LineString = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    };
    expect(geometryToWkt(line)).toBe('LINESTRING (0 0, 1 1)');
  });

  it('formats a Polygon, including a hole ring', () => {
    const poly: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 2],
        ],
      ],
    };
    expect(geometryToWkt(poly)).toBe('POLYGON ((0 0, 10 0, 10 10, 0 0), (2 2, 4 2, 4 4, 2 2))');
  });

  it('throws for an unsupported geometry type', () => {
    const multi: GeoJSON.MultiPoint = { type: 'MultiPoint', coordinates: [[0, 0]] };
    expect(() => geometryToWkt(multi)).toThrow(
      'geometryToWkt: unsupported geometry type MultiPoint'
    );
  });
});

describe('wktToGeometry', () => {
  it('parses a Point', () => {
    expect(wktToGeometry('POINT (1 2)')).toEqual({ type: 'Point', coordinates: [1, 2] });
  });

  it('parses a LineString', () => {
    expect(wktToGeometry('LINESTRING (0 0, 1 1)')).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    });
  });

  it('parses a Polygon, including a hole ring', () => {
    expect(wktToGeometry('POLYGON ((0 0, 10 0, 10 10, 0 0), (2 2, 4 2, 4 4, 2 2))')).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 2],
        ],
      ],
    });
  });

  it('round-trips through geometryToWkt', () => {
    const poly: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
      ],
    };
    expect(wktToGeometry(geometryToWkt(poly))).toEqual(poly);
  });

  it('parses a MultiPolygon of several parts, holes included', () => {
    expect(
      wktToGeometry(
        'MULTIPOLYGON (((0 0, 10 0, 10 10, 0 0), (2 2, 4 2, 4 4, 2 2)), ((20 20, 21 20, 21 21, 20 20)))'
      )
    ).toEqual({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 0],
          ],
          [
            [2, 2],
            [4, 2],
            [4, 4],
            [2, 2],
          ],
        ],
        [
          [
            [20, 20],
            [21, 20],
            [21, 21],
            [20, 20],
          ],
        ],
      ],
    });
  });

  // What PostGIS actually hands back for an ingested field boundary: one part,
  // no spaces after the commas between parts.
  it('parses a single-part MultiPolygon as stored', () => {
    const geometry = wktToGeometry(
      'MULTIPOLYGON (((33.906038746 51.358947137, 33.905348557 51.358907512, 33.904500048 51.35885112, 33.906038746 51.358947137)))'
    );
    expect(geometry.type).toBe('MultiPolygon');
    expect((geometry as GeoJSON.MultiPolygon).coordinates[0][0]).toHaveLength(4);
    expect(geometryCentroid(geometry)).toEqual([33.905269397, 51.3588991285]);
  });

  it('round-trips a MultiPolygon through geometryToWkt', () => {
    const multi: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 0],
          ],
        ],
        [
          [
            [20, 20],
            [21, 20],
            [21, 21],
            [20, 20],
          ],
        ],
      ],
    };
    expect(wktToGeometry(geometryToWkt(multi))).toEqual(multi);
  });

  it('throws for unsupported WKT', () => {
    expect(() => wktToGeometry('MULTIPOINT (0 0)')).toThrow('wktToGeometry: unsupported WKT');
  });
});

describe('geometryCentroid', () => {
  it('a Point centroid is the point itself', () => {
    expect(geometryCentroid({ type: 'Point', coordinates: [5, 5] })).toEqual([5, 5]);
  });

  it('a Polygon centroid is its bounding-box center', () => {
    const poly: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
      ],
    };
    expect(geometryCentroid(poly)).toEqual([5, 5]);
  });
});
