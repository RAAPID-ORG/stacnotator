import type { CampaignOutFull, ImageryViewOut } from '~/api/client';
import type { Catalog } from '~/features/annotation/core/catalog';
import type { WorkMode } from '~/features/annotation/stores';
import type { PanelDef } from '~/features/annotation/engine/canvas';
import type { Binding, HotkeyScope } from '~/features/annotation/engine/hotkeys';

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

export interface Feature {
  panels?: (ctx: ComposeCtx) => PanelDef[];
  hotkeys?: (ctx: ComposeCtx) => HotkeyTable[];
}
