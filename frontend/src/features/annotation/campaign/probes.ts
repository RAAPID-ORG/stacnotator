import type { LonLat } from '~/shared/map/types';
import { geometryCentroid } from './annotation';

export type ZonalGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export type Probe = LonLat | ZonalGeometry;
export type ProbeMode = 'point' | 'draw' | 'select';
export interface LatLon {
  lat: number;
  lon: number;
}
export type TimeseriesLocation = LatLon | ZonalGeometry;

export function isZonalGeometry(geometry: GeoJSON.Geometry): geometry is ZonalGeometry {
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
}

export function probeGeometry(probe: Probe): GeoJSON.Point | ZonalGeometry {
  return Array.isArray(probe) ? { type: 'Point', coordinates: probe } : probe;
}

export function probeLocation(probe: Probe): TimeseriesLocation {
  return Array.isArray(probe) ? { lat: probe[1], lon: probe[0] } : probe;
}

export function geometryLocation(geometry: GeoJSON.Geometry): TimeseriesLocation {
  return isZonalGeometry(geometry) ? geometry : probeLocation(geometryCentroid(geometry));
}

export function locationKey(location: TimeseriesLocation): string {
  return 'type' in location ? JSON.stringify(location) : `point:${location.lat},${location.lon}`;
}
