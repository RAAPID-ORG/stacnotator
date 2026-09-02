import { describe, expect, it } from 'vitest';
import { buildImageryCatalog } from '../campaign/imagery';
import { EMPTY_LAYOUT, type WorkspaceLayout } from '../canvas/grid';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeView,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { buildPanels, CONTROLS_PANEL, MAIN_MAP_PANEL, MINIMAP_PANEL } from './panels';

const CAMPAIGN = makeCampaign({
  imagery_sources: [
    makeSource({
      id: 1,
      visualizations: [makeViz({ id: 10 })],
      collections: [
        makeCollection({ id: 100, name: 'Jan', slices: [makeSlice({ id: 1000 })] }),
        makeCollection({ id: 200, name: 'Feb', slices: [makeSlice({ id: 2000 })] }),
      ],
    }),
  ],
  imagery_views: [makeView({ id: 5, source_ids: [1] })],
});

const CATALOG = buildImageryCatalog(CAMPAIGN);
const VIEW = CAMPAIGN.imagery_views[0];

const item = { i: '', x: 0, y: 0, w: 10, h: 9 };
const LAYOUT: WorkspaceLayout = { ...EMPTY_LAYOUT, windows: { 100: item, 200: item } };

const panelsFor = (activeCollectionId: number | null) =>
  buildPanels({
    campaign: CAMPAIGN,
    catalog: CATALOG,
    view: VIEW,
    mode: 'explore',
    layout: LAYOUT,
    activeCollectionId,
  });

describe('buildPanels', () => {
  it('lists the fixed page panels plus one window per collection the layout carries', () => {
    expect(panelsFor(100).map((p) => p.id)).toEqual([
      MAIN_MAP_PANEL,
      MINIMAP_PANEL,
      CONTROLS_PANEL,
      '100',
      '200',
    ]);
  });

  it('offers every window the hover affordance that says clicking activates it', () => {
    const windows = panelsFor(100).filter((p) => p.role === 'imagery-window');
    expect(windows).toHaveLength(2);
    for (const window of windows) expect(window.className).toContain('grid-card-hoverable');
  });

  it('marks the window of the collection the main map is showing', () => {
    const active = (id: number | null) =>
      panelsFor(id)
        .filter((p) => p.className?.includes('active-window'))
        .map((p) => p.id);

    expect(active(100)).toEqual(['100']);
    // The outline follows a collection change rather than staying where it was.
    expect(active(200)).toEqual(['200']);
    expect(active(null)).toEqual([]);
  });
});
