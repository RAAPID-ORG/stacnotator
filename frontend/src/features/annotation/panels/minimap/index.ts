import { createElement } from 'react';
import type { Feature } from '../registry';
import { MinimapBody, MinimapHeader } from './MinimapPanel';

export const MINIMAP_PANEL_ID = 'minimap';

export const minimapFeature: Feature = {
  panels: (ctx) => [
    {
      id: MINIMAP_PANEL_ID,
      header: createElement(MinimapHeader, { ctx }),
      body: createElement(MinimapBody, { ctx }),
      hideTarget: true,
    },
  ],
};

export { MinimapBody, MinimapHeader } from './MinimapPanel';
export { LocationSearch } from './LocationSearch';
export { buildPhotonUrl, parseGeocodingResponse, type GeocodingResult } from './geocoding';
export { campaignBboxLayer, viewportRectLayer, VIEWPORT_RECT_LAYER_ID } from './ViewportRect';
