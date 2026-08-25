import { describe, it, expect } from 'vitest';
import { buildPhotonUrl, parseGeocodingResponse } from './geocoding';

const feature = (overrides: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [13.4, 52.5] },
  properties: {
    name: 'Berlin',
    city: 'Berlin',
    state: 'Berlin',
    country: 'Germany',
    osm_key: 'place',
    osm_value: 'city',
    ...overrides,
  },
});

describe('parseGeocodingResponse', () => {
  it('parses a valid feature with an extent, normalizing Photon order and deduping the label', () => {
    const raw = {
      type: 'FeatureCollection',
      features: [feature({ extent: [13.0, 52.6, 13.7, 52.3] })],
    };
    expect(parseGeocodingResponse(raw)).toEqual([
      {
        label: 'Berlin, Germany',
        center: [13.4, 52.5],
        extent: [13.0, 52.3, 13.7, 52.6],
      },
    ]);
  });

  it('parses a valid feature without an extent', () => {
    const raw = { type: 'FeatureCollection', features: [feature({ extent: undefined })] };
    const [result] = parseGeocodingResponse(raw);
    expect(result.extent).toBeNull();
    expect(result.center).toEqual([13.4, 52.5]);
  });

  it('normalizes extent order distinctly per axis (not just swapped pairs)', () => {
    // minLon=1, maxLat=9, maxLon=5, minLat=2 -> [minX, minY, maxX, maxY] = [1, 2, 5, 9]
    const raw = { type: 'FeatureCollection', features: [feature({ extent: [1, 9, 5, 2] })] };
    const [result] = parseGeocodingResponse(raw);
    expect(result.extent).toEqual([1, 2, 5, 9]);
  });

  it('falls back to state when city is absent, and skips a repeated part', () => {
    const raw = {
      type: 'FeatureCollection',
      features: [feature({ name: 'Bavaria', city: undefined, state: 'Bavaria' })],
    };
    const [result] = parseGeocodingResponse(raw);
    expect(result.label).toBe('Bavaria, Germany');
  });

  it('skips a malformed feature (missing geometry) but keeps valid siblings', () => {
    const raw = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Nowhere' } }, feature()],
    };
    expect(parseGeocodingResponse(raw)).toHaveLength(1);
  });

  it('skips a feature with no usable name', () => {
    const raw = {
      type: 'FeatureCollection',
      features: [feature({ name: undefined, city: undefined, state: undefined })],
    };
    expect(parseGeocodingResponse(raw)).toEqual([]);
  });

  it('returns [] for non-object input', () => {
    expect(parseGeocodingResponse(null)).toEqual([]);
    expect(parseGeocodingResponse(undefined)).toEqual([]);
    expect(parseGeocodingResponse('oops')).toEqual([]);
    expect(parseGeocodingResponse(42)).toEqual([]);
    expect(parseGeocodingResponse({ features: 'not-an-array' })).toEqual([]);
  });
});

describe('buildPhotonUrl', () => {
  it('encodes the query and pins limit=5', () => {
    expect(buildPhotonUrl('Berlin, Germany')).toBe(
      'https://photon.komoot.io/api/?q=Berlin%2C%20Germany&limit=5'
    );
  });

  it('encodes special characters', () => {
    expect(buildPhotonUrl('São Paulo & Co')).toBe(
      'https://photon.komoot.io/api/?q=S%C3%A3o%20Paulo%20%26%20Co&limit=5'
    );
  });
});
