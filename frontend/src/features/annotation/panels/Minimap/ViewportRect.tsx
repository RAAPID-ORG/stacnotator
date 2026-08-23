import { fromLonLat, toLonLat } from 'ol/proj';
import type { StyleSpec } from '~/shared/map/types';
import type { Bbox, FeatureLayerSpec, LonLat } from '~/shared/map/types';

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

export function viewportRectLayer(bounds: Bbox, zIndex = 5): FeatureLayerSpec {
  return {
    kind: 'features',
    id: VIEWPORT_RECT_LAYER_ID,
    features: [
      {
        id: VIEWPORT_RECT_LAYER_ID,
        geometry: { type: 'Polygon', coordinates: [ringOf(bounds)] },
      },
    ],
    style: VIEWPORT_STYLE,
    zIndex,
  };
}

export function campaignBboxLayer(bounds: Bbox): FeatureLayerSpec {
  return {
    kind: 'features',
    id: 'minimap-campaign-bbox',
    features: [
      { id: 'minimap-campaign-bbox', geometry: { type: 'Polygon', coordinates: [ringOf(bounds)] } },
    ],
    style: { stroke: { color: 'rgba(150,150,150,0.9)', width: 1, dash: [4, 4] } },
    zIndex: 1,
  };
}
