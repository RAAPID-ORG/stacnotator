// TODO: should refactor at some point into semantically meaningfull files. Currently just a dump

export interface LatLon {
  lat: number;
  lon: number;
}

const MONTH_ABBREV = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Capitalize the first letter of a string
 * @param str - The string to capitalize
 * @returns The string with the first letter capitalized
 * @example capitalizeFirst('hello') // Returns 'Hello'
 */
export const capitalizeFirst = (str: string): string => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

type SearchableUser = { display_name?: string | null; email: string };

const userMatchRank = (user: SearchableUser, query: string): number => {
  const name = (user.display_name ?? '').toLowerCase();
  const email = user.email.toLowerCase();
  if (name.startsWith(query) || email.startsWith(query)) return 0;
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (name.includes(query) || email.includes(query)) return 2;
  return -1;
};

/**
 * Case-insensitive user search over display name and email. Results are
 * ranked: full prefix matches first, then name-word prefixes, then substring
 * matches, preserving the incoming order within each tier. An empty query
 * returns all items unchanged.
 */
export const searchUsers = <T>(
  items: T[],
  getUser: (item: T) => SearchableUser,
  rawQuery: string
): T[] => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return items;
  return items
    .map((item) => ({ item, rank: userMatchRank(getUser(item), query) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedEmails {
  emails: string[];
  invalid: string[];
}

/** Splits pasted text on commas/semicolons/whitespace, dedupes
 *  case-insensitively and separates entries that cannot be an address. */
export const parseEmailList = (raw: string): ParsedEmails => {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];

  for (const token of raw.split(/[\s,;]+/)) {
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (EMAIL_PATTERN.test(token)) emails.push(token);
    else invalid.push(token);
  }

  return { emails, invalid };
};

/**
 * Extract latitude and longitude from a WKT POINT string
 * Supports both 2D and 3D (POINT Z) formats
 * @param wkt - Well-Known Text string in POINT format
 * @returns Object with lat and lon properties, or null if parsing fails
 * @example
 * extractLatLonFromWKT('POINT(-122.4194 37.7749)')
 * // Returns { lat: 37.7749, lon: -122.4194 }
 */
export const extractLatLonFromWKT = (wkt: string): LatLon | null => {
  if (!wkt) return null;

  const normalized = wkt.trim().toUpperCase();
  const match = normalized.match(/^POINT(?:\s+Z)?\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);

  if (!match) return null;

  const lon = Number(match[1]);
  const lat = Number(match[2]);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return null;
  }

  return { lat, lon };
};

/**
 * Parse a date string (YYYYMMDD or YYYY-MM-DD format).
 *
 * Builds a local-midnight date so the local getters callers use to format it read
 * back the same calendar day. `new Date('2026-05-01')` would parse as UTC midnight
 * and read back as Apr 30 anywhere west of UTC.
 */
const parseDate = (dateStr: string): Date => {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(dateStr);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  return new Date(dateStr);
};

/**
 * Format a slice label. `endDate` is inclusive, as stored.
 */
export const formatSliceLabel = (
  startDate: string,
  endDate: string,
  slicingUnit: string | null,
  _sliceIndex: number
): string => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const displayEnd = end < start ? start : end;

  const startMonth = start.getMonth();
  const endMonth = displayEnd.getMonth();
  const startDay = start.getDate();
  const endDay = displayEnd.getDate();
  const startYear = start.getFullYear();
  const endYear = displayEnd.getFullYear();

  const unit = slicingUnit?.toLowerCase() || 'days';

  switch (unit) {
    case 'month':
    case 'months':
      if (startMonth === endMonth && startYear === endYear) {
        return MONTH_ABBREV[startMonth];
      }
      if (startYear === endYear) {
        return `${MONTH_ABBREV[startMonth]}-${MONTH_ABBREV[endMonth]}`;
      }
      return `${MONTH_ABBREV[startMonth]} '${String(startYear).slice(2)}`;

    case 'week':
    case 'weeks':
      if (startMonth === endMonth) {
        return `${MONTH_ABBREV[startMonth]} ${startDay}-${endDay}`;
      }
      return `${MONTH_ABBREV[startMonth]} ${startDay} - ${MONTH_ABBREV[endMonth]} ${endDay}`;

    case 'day':
    case 'days':
    default:
      if (startMonth === endMonth && startDay === endDay) {
        return `${MONTH_ABBREV[startMonth]} ${startDay}`;
      }
      if (startMonth === endMonth) {
        return `${MONTH_ABBREV[startMonth]} ${startDay}-${endDay}`;
      }
      return `${MONTH_ABBREV[startMonth]} ${startDay} - ${MONTH_ABBREV[endMonth]} ${endDay}`;
  }
};

/**
 * Format a window label. `endDate` is inclusive, as stored.
 */
export const formatWindowLabel = (
  startDate: string,
  endDate: string,
  windowUnit: string | null
): string => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const displayEnd = end < start ? start : end;

  const startMonth = start.getMonth();
  const endMonth = displayEnd.getMonth();
  const startDay = start.getDate();
  const endDay = displayEnd.getDate();
  const startYear = start.getFullYear();
  const endYear = displayEnd.getFullYear();

  const unit = windowUnit?.toLowerCase() || 'months';

  switch (unit) {
    case 'month':
    case 'months':
      if (startMonth === endMonth && startYear === endYear) {
        return `${MONTH_ABBREV[startMonth]} ${startYear}`;
      }
      if (startYear === endYear) {
        return `${MONTH_ABBREV[startMonth]}-${MONTH_ABBREV[endMonth]} ${startYear}`;
      }
      return `${MONTH_ABBREV[startMonth]} ${startYear} - ${MONTH_ABBREV[endMonth]} ${endYear}`;

    case 'week':
    case 'weeks':
    case 'day':
    case 'days':
    default:
      if (startYear === endYear) {
        if (startMonth === endMonth) {
          if (startDay === endDay) {
            return `${MONTH_ABBREV[startMonth]} ${startDay}, ${startYear}`;
          }
          return `${MONTH_ABBREV[startMonth]} ${startDay}-${endDay}, ${startYear}`;
        }
        return `${MONTH_ABBREV[startMonth]} ${startDay} - ${MONTH_ABBREV[endMonth]} ${endDay}, ${startYear}`;
      }
      return `${MONTH_ABBREV[startMonth]} ${startDay}, ${startYear} - ${MONTH_ABBREV[endMonth]} ${endDay}, ${endYear}`;
  }
};

/**
 * Convert YYYYMM to YYYY-MM
 */
export const yyyymmToInputMonth = (yyyymm: string): string => {
  if (!yyyymm || yyyymm.length !== 6) return '';

  const year = yyyymm.substring(0, 4);
  const month = yyyymm.substring(4, 6);

  return `${year}-${month}`;
};

/**
 * Convert YYYY-MM to YYYYMM
 */
export const inputMonthToYYYYMM = (inputMonth: string): string => {
  if (!inputMonth) return '';
  return inputMonth.replace('-', '');
};

/**
 * Extract the centroid (lat/lon) from any WKT geometry string.
 * Supports POINT, LINESTRING, and POLYGON.
 * For POINT: returns the point itself.
 * For LINESTRING: returns the average of all vertices.
 * For POLYGON: returns the average of the exterior ring vertices.
 *
 * @param wkt - Well-Known Text geometry string
 * @returns Object with lat and lon properties, or null if parsing fails
 */
export const extractCentroidFromWKT = (wkt: string): LatLon | null => {
  if (!wkt) return null;
  const normalized = wkt.trim().toUpperCase();

  // POINT
  const pointMatch = normalized.match(
    /^POINT(?:\s+Z)?\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/
  );
  if (pointMatch) {
    return { lon: parseFloat(pointMatch[1]), lat: parseFloat(pointMatch[2]) };
  }

  // LINESTRING - average of all vertices
  const lineMatch = normalized.match(/^LINESTRING\s*\((.+)\)$/);
  if (lineMatch) {
    const pairs = lineMatch[1].split(',').map((p) => p.trim().split(/\s+/).map(Number));
    if (pairs.length === 0) return null;
    const sumLon = pairs.reduce((s, p) => s + p[0], 0);
    const sumLat = pairs.reduce((s, p) => s + p[1], 0);
    return { lon: sumLon / pairs.length, lat: sumLat / pairs.length };
  }

  // POLYGON - average of exterior ring vertices (skip closing vertex)
  const polyMatch = normalized.match(/^POLYGON\s*\(\((.+?)\)/);
  if (polyMatch) {
    const pairs = polyMatch[1].split(',').map((p) => p.trim().split(/\s+/).map(Number));
    // Drop last vertex if it duplicates the first (closed ring)
    const ring =
      pairs.length > 1 &&
      pairs[0][0] === pairs[pairs.length - 1][0] &&
      pairs[0][1] === pairs[pairs.length - 1][1]
        ? pairs.slice(0, -1)
        : pairs;
    if (ring.length === 0) return null;
    const sumLon = ring.reduce((s, p) => s + p[0], 0);
    const sumLat = ring.reduce((s, p) => s + p[1], 0);
    return { lon: sumLon / ring.length, lat: sumLat / ring.length };
  }

  // MULTIPOLYGON - centroid of the first polygon's exterior ring
  const multiPolyMatch = normalized.match(/^MULTIPOLYGON\s*\(\(\((.+?)\)/);
  if (multiPolyMatch) {
    const pairs = multiPolyMatch[1].split(',').map((p) => p.trim().split(/\s+/).map(Number));
    const ring =
      pairs.length > 1 &&
      pairs[0][0] === pairs[pairs.length - 1][0] &&
      pairs[0][1] === pairs[pairs.length - 1][1]
        ? pairs.slice(0, -1)
        : pairs;
    if (ring.length === 0) return null;
    const sumLon = ring.reduce((s, p) => s + p[0], 0);
    const sumLat = ring.reduce((s, p) => s + p[1], 0);
    return { lon: sumLon / ring.length, lat: sumLat / ring.length };
  }

  // Fallback: try extractLatLonFromWKT for anything else
  return extractLatLonFromWKT(wkt);
};
