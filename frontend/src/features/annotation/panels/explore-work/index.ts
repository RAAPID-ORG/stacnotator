import { createElement } from 'react';
import type { Feature } from '../registry';
import { ExploreControlsPanel } from './ExploreControlsPanel';
import { exploreWorkHotkeys } from './hotkeys';

export const EXPLORE_CONTROLS_PANEL_ID = 'controls';

export const exploreWorkFeature: Feature = {
  panels: (ctx) =>
    ctx.mode === 'explore'
      ? [
          {
            id: EXPLORE_CONTROLS_PANEL_ID,
            title: 'Controls',
            body: createElement(ExploreControlsPanel, { ctx }),
          },
        ]
      : [],
  hotkeys: (ctx) => exploreWorkHotkeys(ctx),
};

export { ExploreControlsPanel, type ExploreControlsPanelProps } from './ExploreControlsPanel';
export { DraftCatalog, type DraftCatalogProps } from './DraftCatalog';
export { EditDetails, type EditDetailsProps } from './EditDetails';
export { LabelStyleEditor, type LabelStyleEditorProps } from './LabelStyleEditor';
export { exploreWorkBindings, exploreWorkHotkeys } from './hotkeys';
