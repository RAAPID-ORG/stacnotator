import type { ReactNode } from 'react';

export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const GRID_COLS = 60;
export const ROW_HEIGHT = 15;
export const GRID_MARGIN: [number, number] = [6, 6];

export interface PanelDef {
  id: string;
  /** Stable classifier for panels whose id is data-dependent (one imagery
   *  window, one timeseries chart). Rendered as `data-panel-role` so anything
   *  that has to find "a panel of this kind" in the DOM - the guided tour's
   *  spotlight - can, without knowing the id. */
  role?: string;
  title?: string;
  /** Rendered inside PanelHost's header, right of the drag area. */
  header?: ReactNode;
  /** e.g. active highlight. */
  headerClassName?: string;
  /** Applied to the panel's outer card, e.g. the active-window outline. */
  className?: string;
  /** Rendered as `data-tour`, the handle the guided tour and the E2E suite
   *  use to find a panel by what it is rather than by its data-dependent id. */
  tourId?: string;
  onHeaderClick?: () => void;
  onBodyClick?: () => void;
  body: ReactNode;
  /** Edit mode: replace the body with a cheap placeholder, so an expensive
   *  panel (a live map) isn't rendered behind a drag ghost. */
  hideTarget?: boolean;
  /** The panel may leave the grid entirely, so the hide action is offered.
   *  Fixed page chrome (the main map, the minimap, the controls slot) is
   *  not hidable - `fromGridLayout` would just put it back. */
  hidable?: boolean;
}

export interface CanvasProps {
  panels: PanelDef[];
  layout: LayoutItem[];
  onLayoutChange?: (l: LayoutItem[]) => void;
  editing: boolean;
  onHidePanel?: (id: string) => void;
  fullscreen?: boolean;
  /** Handle on the scrolling grid container. The hidden tray resolves drop
   *  cells against this element's live rect and scroll offset, and it is the
   *  positioned ancestor its drop preview portals into. */
  outerRef?: React.RefObject<HTMLDivElement | null>;
  /** When set, the grid is static and uses this layout instead. */
  mobileLayout?: LayoutItem[];
}
