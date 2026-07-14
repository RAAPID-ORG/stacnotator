/**
 * Photon (https://photon.komoot.io) is a free, key-less geocoder built for
 * search-as-you-type, so the minimap location search hits it directly from
 * the browser. Its GeoJSON response is untrusted input - every field is
 * narrowed with a type guard rather than trusted via a cast.
 */

const PHOTON_BASE_URL = 'https://photon.komoot.io/api/';
const SUGGESTION_LIMIT = 5;

export interface GeocodingResult {
  label: string;
  /** [lon, lat] in EPSG:4326, matching Photon's GeoJSON coordinate order. */
  center: [number, number];
  /** [minX, minY, maxX, maxY] in EPSG:4326, normalized from Photon's extent order. */
  extent: [number, number, number, number] | null;
}

export function buildPhotonUrl(query: string): string {
  return `${PHOTON_BASE_URL}?q=${encodeURIComponent(query)}&limit=${SUGGESTION_LIMIT}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseCenter(geometry: unknown): [number, number] | null {
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) return null;
  const [lon, lat] = geometry.coordinates;
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) return null;
  return [lon, lat];
}

/** Photon reports extent as [minLon, maxLat, maxLon, minLat] - normalize to [minX, minY, maxX, maxY]. */
function parseExtent(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [minLon, maxLat, maxLon, minLat] = raw;
  if (
    !isFiniteNumber(minLon) ||
    !isFiniteNumber(maxLat) ||
    !isFiniteNumber(maxLon) ||
    !isFiniteNumber(minLat)
  ) {
    return null;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** Name plus the most specific available region (city, else state), plus country - each part deduped. */
function parseLabel(properties: Record<string, unknown>): string | null {
  const name = readString(properties.name);
  if (!name) return null;
  const secondary = readString(properties.city) ?? readString(properties.state);
  const country = readString(properties.country);

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of [name, secondary, country]) {
    if (part && !seen.has(part)) {
      seen.add(part);
      parts.push(part);
    }
  }
  return parts.join(', ');
}

function parseFeature(feature: unknown): GeocodingResult | null {
  if (!isRecord(feature)) return null;
  const center = parseCenter(feature.geometry);
  if (!center) return null;
  if (!isRecord(feature.properties)) return null;
  const label = parseLabel(feature.properties);
  if (!label) return null;
  return { label, center, extent: parseExtent(feature.properties.extent) };
}

export function parseGeocodingResponse(raw: unknown): GeocodingResult[] {
  if (!isRecord(raw) || !Array.isArray(raw.features)) return [];
  const results: GeocodingResult[] = [];
  for (const feature of raw.features) {
    const parsed = parseFeature(feature);
    if (parsed) results.push(parsed);
  }
  return results;
}
