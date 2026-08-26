import type { ReactNode } from 'react';
import { collectionsInView, type ImageryCatalog } from '../campaign/imagery';
import { groupTimeseriesIntoWindows } from '../campaign/timeseries';
import type { WorkspaceLayout } from '../canvas/grid';
import { ExploreControls } from './ExploreControls/ExploreControls';
import { ImageryWindowBody } from './ImageryWindow/ImageryWindow';
import { ImageryWindowHeader } from './ImageryWindow/ImageryWindowHeader';
import { MainMapBody, MainMapHeader } from './MainMap/MainMap';
import { MinimapBody, MinimapHeader } from './Minimap/Minimap';
import { TaskClaimBadge } from './TaskControls/ClaimBadge';
import { TaskControls } from './TaskControls/TaskControls';
import { TimeseriesPanel } from './Timeseries/Timeseries';
import { TimeseriesHeader } from './Timeseries/TimeseriesHeader';
import type { WorkMode } from '../stores/campaign';
import { useImageryStore } from '../stores/imagery';
import type { CampaignOutFull, ImageryViewOut } from '~/api/client';

export const MAIN_MAP_PANEL = 'main';
export const MINIMAP_PANEL = 'minimap';
/** Both modes' controls resolve to the same grid slot. */
export const CONTROLS_PANEL = 'controls';

export interface PanelDef {
  id: string;
  /** Stable classifier for panels whose id is data-dependent (one imagery
   *  window, one chart). Rendered as `data-panel-role` so the guided tour and
   *  the E2E suite can find "a panel of this kind" without knowing the id. */
  role: string;
  title?: string;
  /** Rendered inside the panel header, right of the drag area. */
  header?: ReactNode;
  body: ReactNode;
  className?: string;
  onHeaderClick?: () => void;
  onBodyClick?: () => void;
  /** Edit mode replaces the body with a cheap placeholder, so an expensive
   *  panel is not rendered behind a drag ghost. */
  hideTarget?: boolean;
  /** May leave the grid entirely, so the hide action is offered. Fixed page
   *  chrome is not hidable - the layout would just put it back. */
  hidable?: boolean;
}

export interface PanelContext {
  campaign: CampaignOutFull;
  catalog: ImageryCatalog;
  view: ImageryViewOut | null;
  mode: WorkMode;
  layout: WorkspaceLayout;
  /** The collection the main map is showing, which is the window this list
   *  marks as active. Passed in rather than read off the store so a change of
   *  collection rebuilds the panels and the outline moves with it. */
  activeCollectionId: number | null;
}

/**
 * Which panels the workspace shows right now. The whole list is built here
 * rather than contributed by each surface: there are a fixed handful, they are
 * all known at build time, and a reader should be able to see the workspace's
 * shape in one place.
 */
export function buildPanels({
  campaign,
  catalog,
  view,
  mode,
  layout,
  activeCollectionId,
}: PanelContext): PanelDef[] {
  const panels: PanelDef[] = [
    {
      id: MAIN_MAP_PANEL,
      role: 'main-map',
      header: <MainMapHeader />,
      body: <MainMapBody />,
      // Rendering a live map behind a drag ghost costs tiles nobody is looking at.
      hideTarget: true,
    },
    {
      id: MINIMAP_PANEL,
      role: 'minimap',
      header: <MinimapHeader />,
      body: <MinimapBody />,
      hideTarget: true,
    },
    mode === 'tasks'
      ? {
          id: CONTROLS_PANEL,
          role: 'task-work',
          title: 'Task',
          header: <TaskClaimBadge />,
          body: <TaskControls />,
        }
      : {
          id: CONTROLS_PANEL,
          role: 'explore-work',
          title: 'Controls',
          body: <ExploreControls />,
        },
  ];

  for (const window of groupTimeseriesIntoWindows(campaign.time_series)) {
    panels.push({
      id: window.key,
      role: 'timeseries',
      title: window.title,
      header: <TimeseriesHeader />,
      body: <TimeseriesPanel window={window} />,
    });
  }

  for (const collection of collectionsInView(catalog, view)) {
    if (layout.windows[collection.id] === undefined) continue;
    const activate = () => useImageryStore.getState().activateCollection(catalog, collection.id);
    panels.push({
      id: String(collection.id),
      role: 'imagery-window',
      className: collection.id === activeCollectionId ? 'active-window' : undefined,
      header: <ImageryWindowHeader collection={collection} />,
      body: <ImageryWindowBody collection={collection} />,
      hideTarget: true,
      hidable: true,
      onHeaderClick: activate,
      onBodyClick: activate,
    });
  }

  return panels;
}
