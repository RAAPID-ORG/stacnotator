import type { ReactNode } from 'react';
import { collectionsInView, groupTimeseriesIntoWindows, type Catalog } from './domain/catalog';
import type { WorkspaceLayout } from './canvas/grid';
import { ExploreControls } from './panels/ExploreControls/ExploreControls';
import { ImageryWindowBody } from './panels/ImageryWindow/ImageryWindow';
import { ImageryWindowHeader } from './panels/ImageryWindow/ImageryWindowHeader';
import { MainMapBody, MainMapHeader } from './panels/MainMap/MainMap';
import { MinimapBody, MinimapHeader } from './panels/Minimap/Minimap';
import { TaskClaimBadge } from './panels/TaskControls/ClaimBadge';
import { TaskControls } from './panels/TaskControls/TaskControls';
import { TimeseriesPanel } from './panels/Timeseries/Timeseries';
import type { WorkMode } from './stores/campaign';
import { useImageryStore } from './stores/imagery';
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
  catalog: Catalog;
  view: ImageryViewOut | null;
  mode: WorkMode;
  layout: WorkspaceLayout;
}

/**
 * Which panels the workspace shows right now. The whole list is built here
 * rather than contributed by each surface: there are a fixed handful, they are
 * all known at build time, and a reader should be able to see the workspace's
 * shape in one place.
 */
export function buildPanels({ campaign, catalog, view, mode, layout }: PanelContext): PanelDef[] {
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
      body: <TimeseriesPanel window={window} />,
    });
  }

  const activeCollectionId = useImageryStore.getState().address?.collectionId;
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
