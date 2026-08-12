import type { Bbox, FeatureLayerSpec, StyleSpec } from '~/features/annotation/engine/map';

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
