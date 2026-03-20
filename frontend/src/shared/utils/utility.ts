export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Compute a square extent polygon (GeoJSON) around a lat/lon point given a size in meters.
 * Returns a closed ring polygon in WGS84 coordinates.
 */
export const computeExtentGeoJSON = (
  lat: number,
  lon: number,
  sizeMeters: number,
): GeoJSON.Polygon => {
  const half = sizeMeters / 2;
  // Approximate degree offsets from meters
  const dLat = half / 111_320;
  const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
        [lon - dLon, lat - dLat],
      ],
    ],
  };
};

export interface TimeSlice {
  index: number;
  startDate: string;
  endDate: string;
  label: string;
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
 * Convert a string to a URL-friendly key (slug)
 * - Converts to lowercase
 * - Removes diacritics/accents
 * - Replaces non-alphanumeric characters with hyphens
 * - Removes leading/trailing hyphens
 * @param name - The string to convert
 * @returns URL-friendly slug
 * @example
 * name_to_key('Hello World!') // Returns 'hello-world'
 * name_to_key('Café Münchën') // Returns 'cafe-munchen'
 */
export const name_to_key = (name: string): string => {
  return (
    name
      .toLowerCase()
      .trim()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
};

/**
 * Parse a date string (YYYYMMDD or YYYY-MM-DD format)
 */
const parseDate = (dateStr: string): Date => {
  if (/^\d{8}$/.test(dateStr)) {
    const year = parseInt(dateStr.substring(0, 4), 10);
    const month = parseInt(dateStr.substring(4, 6), 10) - 1;
    const day = parseInt(dateStr.substring(6, 8), 10);
    return new Date(year, month, day);
  }
  return new Date(dateStr);
};

/**
 * Format a Date object to YYYYMMDD string
 */
const formatDateYYYYMMDD = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

/**
 * Format a date string for display (YYYYMMDD to YYYY-MM-DD)
 */
const formatDateForDisplay = (dateStr: string): string => {
  if (/^\d{8}$/.test(dateStr)) {
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  }
  return dateStr;
};

/**
 * Add a duration to a date based on unit
 */
const addDuration = (date: Date, interval: number, unit: string): Date => {
  const result = new Date(date);

  switch (unit.toLowerCase()) {
    case 'day':
    case 'days':
      result.setDate(result.getDate() + interval);
      break;
    case 'week':
    case 'weeks':
      result.setDate(result.getDate() + interval * 7);
      break;
    case 'month':
    case 'months':
      result.setMonth(result.getMonth() + interval);
      break;
    case 'year':
    case 'years':
      result.setFullYear(result.getFullYear() + interval);
      break;
    default:
      result.setDate(result.getDate() + interval);
  }

  return result;
};

/**
 * Format a date range for display
 */
const formatDateRange = (start: string, end: string): string => {
  const startDisplay = formatDateForDisplay(start);
  const endDisplay = formatDateForDisplay(end);
  if (startDisplay === endDisplay) {
    return startDisplay;
  }
  return `${startDisplay} - ${endDisplay}`;
};

/**
 * Compute time slices within a window
 */
export const computeTimeSlices = (
  windowStartDate: string,
  windowEndDate: string,
  slicingInterval: number | null,
  slicingUnit: string | null
): TimeSlice[] => {
  if (!slicingInterval || !slicingUnit) {
    return [
      {
        index: 0,
        startDate: windowStartDate,
        endDate: windowEndDate,
        label: formatDateRange(windowStartDate, windowEndDate),
      },
    ];
  }

  const slices: TimeSlice[] = [];
  const start = parseDate(windowStartDate);
  const end = parseDate(windowEndDate);

  let currentStart = new Date(start);
  let index = 0;

  while (currentStart < end) {
    const currentEnd = addDuration(new Date(currentStart), slicingInterval, slicingUnit);
    const sliceEnd = currentEnd > end ? end : currentEnd;

    const startDateStr = formatDateYYYYMMDD(currentStart);
    const endDateStr = formatDateYYYYMMDD(sliceEnd);

    slices.push({
      index,
      startDate: startDateStr,
      endDate: endDateStr,
      label: formatSliceLabel(startDateStr, endDateStr, slicingUnit, index),
    });

    currentStart = new Date(sliceEnd);
    index++;
  }

  return slices;
};

/**
 * Format a slice label
 */
export const formatSliceLabel = (
  startDate: string,
  endDate: string,
  slicingUnit: string | null,
  _sliceIndex: number
): string => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const endAdjusted = new Date(end);
  endAdjusted.setDate(endAdjusted.getDate() - 1);
  const displayEnd = endAdjusted < start ? start : endAdjusted;

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
 * Format a window label
 */
export const formatWindowLabel = (
  startDate: string,
  endDate: string,
  windowUnit: string | null
): string => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const endAdjusted = new Date(end);
  endAdjusted.setDate(endAdjusted.getDate() - 1);
  const displayEnd = endAdjusted < start ? start : endAdjusted;

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
 * Format YYYYMM to display
 */
export const formatYearMonth = (yyyymm: string): string => {
  if (!yyyymm || yyyymm.length < 6) return yyyymm;

  const year = yyyymm.substring(0, 4);
  const monthIndex = parseInt(yyyymm.substring(4, 6), 10) - 1;

  if (monthIndex < 0 || monthIndex > 11) return yyyymm;

  return `${MONTH_ABBREV[monthIndex]} ${year}`;
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
 * Convert GeoJSON geometry to WKT string format
 */
export const convertGeoJSONToWKT = (geometry: GeoJSON.Geometry): string => {
  switch (geometry.type) {
    case 'Point': {
      const [lon, lat] = geometry.coordinates as [number, number];
      return `POINT (${lon} ${lat})`;
    }
    case 'LineString': {
      const coords = (geometry.coordinates as [number, number][])
        .map(([lon, lat]) => `${lon} ${lat}`)
        .join(', ');
      return `LINESTRING (${coords})`;
    }
    case 'Polygon': {
      const rings = (geometry.coordinates as [number, number][][])
        .map((ring) => {
          const coords = ring.map(([lon, lat]) => `${lon} ${lat}`).join(', ');
          return `(${coords})`;
        })
        .join(', ');
      return `POLYGON (${rings})`;
    }
    default:
      throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }
};

/**
 * Convert WKT string to GeoJSON geometry
 */
export const convertWKTToGeoJSON = (wkt: string): GeoJSON.Geometry | null => {
  if (!wkt) return null;

  const normalized = wkt.trim().toUpperCase();

  // Parse POINT
  const pointMatch = normalized.match(/^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/);
  if (pointMatch) {
    return {
      type: 'Point',
      coordinates: [parseFloat(pointMatch[1]), parseFloat(pointMatch[2])],
    };
  }

  // Parse LINESTRING
  const lineMatch = normalized.match(/^LINESTRING\s*\((.+)\)$/);
  if (lineMatch) {
    const coords = lineMatch[1].split(',').map((pair) => {
      const [lon, lat] = pair.trim().split(/\s+/);
      return [parseFloat(lon), parseFloat(lat)];
    });
    return {
      type: 'LineString',
      coordinates: coords,
    };
  }

  // Parse POLYGON
  const polygonMatch = normalized.match(/^POLYGON\s*\((.+)\)$/);
  if (polygonMatch) {
    const rings = polygonMatch[1].split(/\)\s*,\s*\(/).map((ring, i, arr) => {
      // Remove leading/trailing parens from first/last ring
      let cleanRing = ring;
      if (i === 0) cleanRing = cleanRing.replace(/^\(/, '');
      if (i === arr.length - 1) cleanRing = cleanRing.replace(/\)$/, '');

      return cleanRing.split(',').map((pair) => {
        const [lon, lat] = pair.trim().split(/\s+/);
        return [parseFloat(lon), parseFloat(lat)];
      });
    });
    return {
      type: 'Polygon',
      coordinates: rings,
    };
  }

  // Parse MULTIPOLYGON
  const multiPolyMatch = normalized.match(/^MULTIPOLYGON\s*\(\(\((.+)\)\)\)$/);
  if (multiPolyMatch) {
    const polygonsRaw = multiPolyMatch[1].split(/\)\)\s*,\s*\(\(/);
    const polygons = polygonsRaw.map((polyStr) => {
      const rings = polyStr.split(/\)\s*,\s*\(/).map((ring) => {
        const cleanRing = ring.replace(/^\(/, '').replace(/\)$/, '');
        return cleanRing.split(',').map((pair) => {
          const [lon, lat] = pair.trim().split(/\s+/);
          return [parseFloat(lon), parseFloat(lat)];
        });
      });
      return rings;
    });
    return {
      type: 'MultiPolygon',
      coordinates: polygons,
    };
  }

  return null;
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

/**
 * Mock API function for magic wand auto-segmentation
 * In production, this would call a backend AI model for semantic segmentation
 * For now, returns a bounding box polygon around the clicked point
 *
 * @param lat - Latitude of the clicked point
 * @param lon - Longitude of the clicked point
 * @param bufferSize - Size of the bounding box buffer (default: 0.001 degrees ~= 100m)
 * @returns Promise resolving to a GeoJSON Polygon geometry
 */
export const mockMagicWandSegmentation = async (
  lat: number,
  lon: number,
  bufferSize: number = 0.001
): Promise<GeoJSON.Polygon> => {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Create a bounding box around the point
  const minLon = lon - bufferSize;
  const maxLon = lon + bufferSize;
  const minLat = lat - bufferSize;
  const maxLat = lat + bufferSize;

  // Return a GeoJSON polygon (bbox as a closed ring)
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat], // Close the ring
      ],
    ],
  };
};
