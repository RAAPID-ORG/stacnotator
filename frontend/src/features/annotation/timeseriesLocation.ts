import Polygon from 'ol/geom/Polygon';
import { getInteriorPointOfArray } from 'ol/geom/flat/interiorpoint';
import { getCenter } from 'ol/extent';
import { geometryCentroid } from './campaign/annotation';
import { isZonalGeometry, type Probe, type TimeseriesLocation } from './campaign/probes';

export function probeLocation(probe: Probe): TimeseriesLocation {
  if (Array.isArray(probe)) return { lat: probe[1], lon: probe[0] };
  const polygons = probe.type === 'Polygon' ? [probe.coordinates] : probe.coordinates;
  const vertices = polygons.reduce((n, rings) => rings.reduce((v, ring) => v + ring.length, n), 0);
  if (vertices <= 15_000) return probe;
  const largest = polygons
    .map((rings) => new Polygon(rings))
    .reduce((best, next) => (next.getArea() > best.getArea() ? next : best));
  const center = getCenter(largest.getExtent());
  const coords = largest.getFlatCoordinates();
  const stride = largest.getStride();
  // Keep the sampling line off vertices and horizontal edges, including hole boundaries.
  let below = -Infinity;
  let above = Infinity;
  for (let i = 1; i < coords.length; i += stride) {
    const y = coords[i];
    if (y <= center[1]) below = Math.max(below, y);
    else above = Math.min(above, y);
  }
  center[1] = (below + above) / 2;
  const [lon, lat] = getInteriorPointOfArray(coords, 0, largest.getEnds(), stride, center, 0);
  return { lat, lon, polygonSample: true };
}

export function geometryLocation(geometry: GeoJSON.Geometry): TimeseriesLocation {
  return probeLocation(isZonalGeometry(geometry) ? geometry : geometryCentroid(geometry));
}
