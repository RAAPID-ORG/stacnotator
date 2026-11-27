import type { LonLat } from '~/shared/map/types';

export type ZonalGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export type Probe = LonLat | ZonalGeometry;
export type ProbeMode = 'point' | 'draw' | 'select';
export interface LatLon {
  lat: number;
  lon: number;
  polygonSample?: true;
}
export type TimeseriesLocation = LatLon | ZonalGeometry;

export function isZonalGeometry(geometry: GeoJSON.Geometry): geometry is ZonalGeometry {
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
}

export function probeGeometry(probe: Probe): GeoJSON.Point | ZonalGeometry {
  return Array.isArray(probe) ? { type: 'Point', coordinates: probe } : probe;
}

export function locationKey(location: TimeseriesLocation): string {
  return 'type' in location ? JSON.stringify(location) : `point:${location.lat},${location.lon}`;
}
