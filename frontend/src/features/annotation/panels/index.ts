import type { PanelDef } from '~/features/annotation/engine/canvas';
import { registerBindings } from '~/features/annotation/engine/hotkeys';
import { drawingFeature } from './drawing';
import { exploreWorkFeature } from './explore-work';
import { imageryWindowsFeature } from './imagery-windows';
import { layoutEditFeature } from './layout-edit';
import { mainMapFeature } from './main-map';
import { minimapFeature } from './minimap';
import type { ComposeCtx, Feature } from './registry';
import { taskWorkFeature, TASK_CONTROLS_PANEL_ID } from './task-work';
import { timeseriesFeature } from './timeseries';
import { toolbarFeature } from './toolbar';

/** The grid key both modes' controls panels resolve to. */
export const CONTROLS_PANEL_ID = 'controls';

export interface NamedFeature {
  name: string;
  feature: Feature;
}

/** Every feature, in the order their panels are composed. Mode- and
 *  device-specific selection is `activeFeatures`; this is the full catalogue. */
export const ALL_FEATURES: readonly NamedFeature[] = [
  { name: 'main-map', feature: mainMapFeature },
  { name: 'imagery-windows', feature: imageryWindowsFeature },
  { name: 'minimap', feature: minimapFeature },
  { name: 'timeseries', feature: timeseriesFeature },
  { name: 'task-work', feature: taskWorkFeature },
  { name: 'explore-work', feature: exploreWorkFeature },
  { name: 'drawing', feature: drawingFeature },
  { name: 'toolbar', feature: toolbarFeature },
  { name: 'layout-edit', feature: layoutEditFeature },
];

const MODE_FEATURES: Record<ComposeCtx['mode'], string[]> = {
  tasks: ['task-work'],
  // Drawing is Explore's map behaviour, and it is also the one feature that
  // edits data by pointer - mobile gets the read-only canvas instead (the
  // brief's "no edit affordances on mobile").
  explore: ['explore-work', 'drawing'],
};

const MODE_ONLY = new Set(Object.values(MODE_FEATURES).flat());

/** The features this page actually mounts: everything mode-independent, plus
 *  the current mode's own, minus the ones mobile has no affordance for. */
export function activeFeatures(ctx: ComposeCtx): NamedFeature[] {
  const forMode = new Set(MODE_FEATURES[ctx.mode]);
  return ALL_FEATURES.filter(({ name }) => {
    if (MODE_ONLY.has(name) && !forMode.has(name)) return false;
    return !(ctx.isMobile && name === 'drawing');
  });
}

export function featuresToPanels(features: NamedFeature[], ctx: ComposeCtx): PanelDef[] {
  return features.flatMap(({ name, feature }) =>
    (feature.panels?.(ctx) ?? []).map((panel) => ({
      ...panel,
      role: panel.role ?? name,
      id: panel.id === TASK_CONTROLS_PANEL_ID ? CONTROLS_PANEL_ID : panel.id,
    }))
  );
}

/** Registers every active feature's hotkey tables; the returned function
 *  unregisters all of them, in reverse, for the caller's effect cleanup. */
export function registerAllHotkeys(features: NamedFeature[], ctx: ComposeCtx): () => void {
  const unregister = features.flatMap(({ feature }) =>
    (feature.hotkeys?.(ctx) ?? []).map(({ scope, table }) => registerBindings(scope, table))
  );
  return () => {
    // Copy before reversing: `unregister` is captured by this closure and a
    // second call would otherwise unregister in a different order.
    for (const off of [...unregister].reverse()) off();
  };
}

export type { ComposeCtx, Feature, HotkeyTable } from './registry';
