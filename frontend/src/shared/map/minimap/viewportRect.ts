import { fromLonLat, toLonLat } from 'ol/proj';
import type { Bbox, FeatureLayerSpec, LonLat, StyleSpec } from '../types';

export const VIEWPORT_RECT_LAYER_ID = 'minimap-viewport';

const VIEWPORT_STYLE: StyleSpec = {
  stroke: { color: 'rgba(50,98,71,0.9)', width: 2 },
  fill: { color: 'rgba(50,98,71,0.15)' },
};

function ringOf([west, south, east, north]: Bbox): GeoJSON.Position[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export function containsPoint([west, south, east, north]: Bbox, [lon, lat]: LonLat): boolean {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

export function translateBounds(
  [west, south, east, north]: Bbox,
  [deltaLon, deltaLat]: LonLat
): Bbox {
  return [west + deltaLon, south + deltaLat, east + deltaLon, north + deltaLat];
}

/** The middle of the rectangle as drawn, which is where the camera it stands
 *  for is pointed. Web Mercator stretches latitudes apart towards the poles, so
 *  averaging north and south lands below the visual middle - by a kilometre on
 *  a zoomed-out viewport, which is enough to miss what the user aimed at. */
export function centerOfBounds([west, south, east, north]: Bbox): LonLat {
  const [x0, y0] = fromLonLat([west, south]);
  const [x1, y1] = fromLonLat([east, north]);
  const [lon, lat] = toLonLat([(x0 + x1) / 2, (y0 + y1) / 2]);
  return [lon, lat];
}

/** Below this many pixels on either side the rectangle is a speck: present,
 *  but read as nothing at all against the basemap. Zoomed far out on the main
 *  map, that is exactly when knowing where you are looking matters most. */
export const MIN_LEGIBLE_RECT_PX = 12;

const VIEWPORT_MARKER_STYLE: StyleSpec = {
  circle: {
    radius: 4,
    stroke: { color: 'rgba(255,255,255,0.9)', width: 1.5 },
    fill: { color: 'rgba(50,98,71,0.95)' },
  },
};

/** Whether the viewport is big enough on screen to draw as its actual box. */
export function rectIsLegible([widthPx, heightPx]: [number, number]): boolean {
  return widthPx >= MIN_LEGIBLE_RECT_PX && heightPx >= MIN_LEGIBLE_RECT_PX;
}

/** The main map's viewport, as its true box - or, when that box would be too
 *  small to see, as a dot on its centre. Dragging still works either way: the
 *  hit test runs against the real bounds, not against what is drawn. */
export function viewportRectLayer(
  bounds: Bbox,
  { zIndex = 5, asMarker = false }: { zIndex?: number; asMarker?: boolean } = {}
): FeatureLayerSpec {
  const geometry: GeoJSON.Geometry = asMarker
    ? { type: 'Point', coordinates: centerOfBounds(bounds) }
    : { type: 'Polygon', coordinates: [ringOf(bounds)] };
  return {
    kind: 'features',
    id: VIEWPORT_RECT_LAYER_ID,
    features: [{ id: VIEWPORT_RECT_LAYER_ID, geometry }],
    style: asMarker ? VIEWPORT_MARKER_STYLE : VIEWPORT_STYLE,
    zIndex,
  };
}

export const PIN_LAYER_ID = 'minimap-pin';

/** A fixed place the overview is about, drawn where the viewport rectangle
 *  would otherwise go - and as the same dot, since to the eye it means the
 *  same thing. It marks that spot and nothing else: the overview camera is
 *  free to move around it. */
export function pinLayer(point: LonLat, zIndex = 5): FeatureLayerSpec {
  return {
    kind: 'features',
    id: PIN_LAYER_ID,
    features: [{ id: PIN_LAYER_ID, geometry: { type: 'Point', coordinates: point } }],
    style: VIEWPORT_MARKER_STYLE,
    zIndex,
  };
}

/** The area the overview is about, drawn as a dashed outline behind everything. */
export function roiOutlineLayer(bounds: Bbox): FeatureLayerSpec {
  return {
    kind: 'features',
    id: 'minimap-roi',
    features: [{ id: 'minimap-roi', geometry: { type: 'Polygon', coordinates: [ringOf(bounds)] } }],
    style: { stroke: { color: 'rgba(150,150,150,0.9)', width: 1, dash: [4, 4] } },
    zIndex: 1,
  };
}
