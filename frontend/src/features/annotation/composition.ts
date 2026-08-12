import type { CampaignOutFull, ImageryViewOut } from '~/api/client';
import type { Catalog } from '~/features/annotation/core/catalog';
import type { WorkMode } from '~/features/annotation/stores';
import type { PanelDef } from '~/features/annotation/engine/canvas';
import {
  registerBindings,
  type Binding,
  type HotkeyScope,
} from '~/features/annotation/engine/hotkeys';
import { drawingFeature } from './drawing';
import { exploreWorkFeature } from './panels/explore-work';
import { imageryWindowsFeature } from './panels/imagery-windows';
import { mainMapFeature } from './panels/main-map';
import { minimapFeature } from './panels/minimap';
import { taskWorkFeature, TASK_CONTROLS_PANEL_ID } from './panels/task-work';
import { timeseriesFeature } from './panels/timeseries';

export interface ComposeCtx {
  campaign: CampaignOutFull;
  catalog: Catalog;
  /** The imagery view in use, or null for a campaign with no views. */
  view: ImageryViewOut | null;
  mode: WorkMode;
  isMobile: boolean;
}

export interface HotkeyTable {
  scope: HotkeyScope;
  table: Binding[];
}

/** What a surface contributes to the page. Page chrome (the toolbar, the
 *  tour, the mobile nav) is rendered directly by AnnotationPage and needs
 *  none of this. */
export interface Feature {
  panels?: (ctx: ComposeCtx) => PanelDef[];
  hotkeys?: (ctx: ComposeCtx) => HotkeyTable[];
}

/** The grid key both modes' controls panels resolve to. */
export const CONTROLS_PANEL_ID = 'controls';

export interface NamedFeature {
  name: string;
  feature: Feature;
}

export const ALL_FEATURES: readonly NamedFeature[] = [
  { name: 'main-map', feature: mainMapFeature },
  { name: 'imagery-windows', feature: imageryWindowsFeature },
  { name: 'minimap', feature: minimapFeature },
  { name: 'timeseries', feature: timeseriesFeature },
  { name: 'task-work', feature: taskWorkFeature },
  { name: 'explore-work', feature: exploreWorkFeature },
  { name: 'drawing', feature: drawingFeature },
];

const MODE_FEATURES: Record<ComposeCtx['mode'], string[]> = {
  tasks: ['task-work'],
  // Drawing is Explore's map behaviour, and it is also the one surface that
  // edits data by pointer - mobile gets the read-only canvas instead.
  explore: ['explore-work', 'drawing'],
};

const MODE_ONLY = new Set(Object.values(MODE_FEATURES).flat());

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

/** Registers every active surface's hotkey tables; the returned function
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
