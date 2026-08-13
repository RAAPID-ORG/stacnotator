import { createElement } from 'react';
import { collectionsInView } from '~/features/annotation/core/catalog';
import { useImageryStore, useWorkspaceStore } from '~/features/annotation/stores';
import type { Feature } from '../../composition';
import { WindowHeader } from './WindowHeader';
import { activateWindow, WindowBody } from './WindowPanel';

export const imageryWindowsFeature: Feature = {
  panels: (ctx) => {
    const sourceIds = ctx.view?.source_ids ?? [];
    const windows = useWorkspaceStore.getState().currentLayout.view.windows;
    const collections = collectionsInView(ctx.catalog, { source_ids: sourceIds }).filter(
      (c) => windows[c.id] !== undefined
    );

    return collections.map((collection) => ({
      id: String(collection.id),
      header: createElement(WindowHeader, { ctx, collection }),
      body: createElement(WindowBody, { ctx, collection }),
      hideTarget: true,
      hidable: true,
      onHeaderClick: () => activateWindow(ctx.catalog, useImageryStore.getState(), collection.id),
      onBodyClick: () => activateWindow(ctx.catalog, useImageryStore.getState(), collection.id),
    }));
  },
};

export { WindowHeader } from './WindowHeader';
export {
  activateWindow,
  selectWindowSlice,
  windowAddress,
  WindowBody,
  type WindowProps,
} from './WindowPanel';
export {
  candidateOrder,
  healingEnabled,
  nextProbe,
  shouldHeal,
  startProbe,
  useEmptyHealing,
  type EmptyHealingResult,
  type ProbeCandidate,
  type ProbePhase,
  type ProbeState,
  type UseEmptyHealingArgs,
} from './useEmptyHealing';
