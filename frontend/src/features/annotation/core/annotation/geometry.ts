function extentOf(geometry: GeoJSON.Geometry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (value: unknown): void => {
    if (Array.isArray(value) && typeof value[0] === 'number') {
      const [x, y] = value as [number, number];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach((g) => visit(g.type === 'GeometryCollection' ? [] : g.coordinates));
  } else {
    visit(geometry.coordinates);
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Stable per-feature key so a feature that spans several vector tiles is
 * only counted once when box-selecting. MVT feature ids are stable across
 * tiles, so prefer them (namespaced per layer, since ids are only unique
 * within a layer). Falls back to a rounded geometry-extent key when the
 * source carries no ids.
 */
export function featureDedupeKey(
  layerId: unknown,
  id: string | number | undefined,
  geometry: GeoJSON.Geometry
): string {
  if (id !== undefined) return `${layerId}:id:${id}`;
  const extent = extentOf(geometry);
  return `${layerId}:geom:${geometry.type}:${extent.map((n) => Math.round(n)).join(',')}`;
}

function ringWkt(ring: number[][]): string {
  return `(${ring.map(([x, y]) => `${x} ${y}`).join(', ')})`;
}

/**
 * Minimal GeoJSON -> WKT for the shapes DrawShape supports (Point/
 * LineString/Polygon) - all AnnotationCreate needs for geometry_wkt.
 */
export function geometryToWkt(geometry: GeoJSON.Geometry): string {
  switch (geometry.type) {
    case 'Point':
      return `POINT (${geometry.coordinates[0]} ${geometry.coordinates[1]})`;
    case 'LineString':
      return `LINESTRING (${geometry.coordinates.map(([x, y]) => `${x} ${y}`).join(', ')})`;
    case 'Polygon':
      return `POLYGON (${geometry.coordinates.map(ringWkt).join(', ')})`;
    default:
      throw new Error(`geometryToWkt: unsupported geometry type ${geometry.type}`);
  }
}

function parseCoordPair(pair: string): [number, number] {
  const [x, y] = pair.trim().split(/\s+/).map(Number);
  return [x, y];
}

function parseRing(ring: string): [number, number][] {
  return ring
    .trim()
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map(parseCoordPair);
}

/**
 * The inverse of geometryToWkt, for the same shape subset (Point/LineString/
 * Polygon) - task and annotation geometries arrive from the backend as WKT
 * (AnnotationTaskOut.geometry.geometry) and every map-facing use needs
 * GeoJSON.
 */
export function wktToGeometry(wkt: string): GeoJSON.Geometry {
  const trimmed = wkt.trim();

  const point = /^POINT\s*\(([^)]+)\)$/i.exec(trimmed);
  if (point) return { type: 'Point', coordinates: parseCoordPair(point[1]) };

  const line = /^LINESTRING\s*\(([^)]+)\)$/i.exec(trimmed);
  if (line) return { type: 'LineString', coordinates: line[1].split(',').map(parseCoordPair) };

  const polygon = /^POLYGON\s*\(\((.+)\)\)$/i.exec(trimmed);
  if (polygon) {
    const rings = polygon[1].split(/\)\s*,\s*\(/).map(parseRing);
    return { type: 'Polygon', coordinates: rings };
  }

  throw new Error(`wktToGeometry: unsupported WKT "${wkt}"`);
}

/** Bounding-box center - a simple, deterministic stand-in for a true
 *  geometric centroid, good enough for "recenter the map on this task". */
export function geometryCentroid(geometry: GeoJSON.Geometry): [number, number] {
  const [minX, minY, maxX, maxY] = extentOf(geometry);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}
