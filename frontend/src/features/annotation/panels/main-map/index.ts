import { createElement } from 'react';
import type { Feature } from '../../composition';
import { MainMapBody, MainMapHeader } from './MainMapPanel';
import { mainMapBindings } from './hotkeys';

export const MAIN_MAP_PANEL_ID = 'main';

export const mainMapFeature: Feature = {
  panels: (ctx) => [
    {
      id: MAIN_MAP_PANEL_ID,
      title: 'Map',
      header: createElement(MainMapHeader, { ctx }),
      body: createElement(MainMapBody, { ctx }),
      // Editing the layout swaps the map for a hide target: rendering a live
      // map behind the drag ghost costs tiles nobody is looking at.
      hideTarget: true,
    },
  ],
  hotkeys: (ctx) => [{ scope: 'global', table: mainMapBindings(ctx) }],
};

export { MainMapBody, MainMapHeader, taskProbeClick, type MainMapProps } from './MainMapPanel';
export {
  fitBbox,
  fitAnnotations,
  getMapFocus,
  pan,
  recenter,
  setMapFocus,
  useFocusCamera,
  useMapFocus,
  zoom,
  type MapFocus,
} from './cameraBus';
export { hotkeyTip, mainMapBindings, resetMainMapNav, stopSliceAutoNav } from './hotkeys';
export {
  PRELOAD_TIER_CONCURRENCY,
  autoPreloadTier,
  preloadConcurrency,
  resolvePreloadTier,
  usePreloading,
} from './usePreloading';
