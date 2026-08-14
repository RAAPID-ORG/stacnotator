import { beforeEach, describe, expect, it } from 'vitest';
import { buildImageryCatalog } from '../campaign/imagery';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeView,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { useImageryStore } from './imagery';
import { startCollectionFor, useCampaignStore } from './campaign';
import { useLayoutStore } from './layout';
import { usePrefsStore } from './prefs';
import { EMPTY_LAYOUT } from '../canvas/grid';

const layoutOut = (id: number, collectionIds: number[]) => ({
  id,
  user_id: null,
  layout_data: collectionIds.map((cid, index) => ({
    i: String(cid),
    x: index * 10,
    y: 30,
    w: 10,
    h: 9,
  })),
});

const source = makeSource({
  id: 1,
  name: 'S1',
  visualizations: [makeViz({ id: 1, name: 'True Color' })],
  collections: [
    makeCollection({ id: 10, name: 'A', slices: [makeSlice({ id: 100, name: 's0' })] }),
  ],
});
const cat = buildImageryCatalog(makeCampaign({ imagery_sources: [source] }));

beforeEach(() => {
  useCampaignStore.setState({
    catalog: cat,
    workMode: 'explore',
    isReviewMode: false,
    view: null,
    taskStartCollectionId: null,
  });
  usePrefsStore.setState({ pinnedStart: {} });
  useLayoutStore.setState({
    currentLayout: EMPTY_LAYOUT,
    savedLayout: EMPTY_LAYOUT,
    editing: false,
  });
  useImageryStore.setState({
    address: null,
    showBasemap: false,
    selectedBasemapId: null,
    overlay: { id: null, visible: true },
    vector: { id: null, visible: true },
    empties: {},
    crosshair: true,
    showAnnotations: true,
    viewSync: true,
    viewSnapshots: {},
  });
});

describe('setWorkMode', () => {
  it('drops isReviewMode when entering explore and turns the crosshair off', () => {
    useCampaignStore.setState({ isReviewMode: true });
    useCampaignStore.getState().setWorkMode('explore');
    expect(useCampaignStore.getState().workMode).toBe('explore');
    expect(useCampaignStore.getState().isReviewMode).toBe(false);
    expect(useImageryStore.getState().crosshair).toBe(false);
  });

  it('turns the crosshair on for tasks mode', () => {
    useCampaignStore.getState().setWorkMode('tasks');
    expect(useImageryStore.getState().crosshair).toBe(true);
  });
});

describe('selectView', () => {
  it('opens the view on its start collection and hands the snapshot to imagery.switchView', () => {
    useCampaignStore.getState().selectView(makeView({ id: 1, source_ids: [1] }));
    expect(useCampaignStore.getState().view?.id).toBe(1);
    expect(useCampaignStore.getState().taskStartCollectionId).toBe(10);
    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 10,
      sliceIndex: 0,
      vizId: '1',
    });

    useImageryStore.setState({ showBasemap: true });
    useCampaignStore.getState().selectView(makeView({ id: 2 }));
    expect(useCampaignStore.getState().view?.id).toBe(2);
    expect(useCampaignStore.getState().taskStartCollectionId).toBeNull();
    expect(useImageryStore.getState().viewSnapshots[1]?.showBasemap).toBe(true);
  });

  it('brings the selected view its own canvas windows', () => {
    const first = makeView({
      id: 1,
      source_ids: [1],
      default_canvas_layout: layoutOut(1, [10]),
    });
    const second = makeView({ id: 2, default_canvas_layout: layoutOut(2, [20, 30]) });

    useCampaignStore.getState().selectView(first);
    expect(Object.keys(useLayoutStore.getState().currentLayout.windows)).toEqual(['10']);

    useCampaignStore.getState().selectView(second);
    expect(Object.keys(useLayoutStore.getState().currentLayout.windows)).toEqual(['20', '30']);

    useCampaignStore.getState().selectView(first);
    expect(Object.keys(useLayoutStore.getState().currentLayout.windows)).toEqual(['10']);
  });
});

describe('startCollectionFor', () => {
  const dated = (id: number, start: string) =>
    makeCollection({ id, name: `C${id}`, slices: [makeSlice({ id: id * 10, start_date: start })] });
  const catalog = buildImageryCatalog(
    makeCampaign({
      imagery_sources: [
        makeSource({
          id: 1,
          visualizations: [makeViz({ id: 1 })],
          collections: [dated(30, '2024-03-01'), dated(10, '2024-01-01'), dated(20, '2024-02-01')],
        }),
      ],
    })
  );
  const view = makeView({ id: 7, source_ids: [1] });
  const window = { i: '', x: 0, y: 0, w: 10, h: 9 };

  it('takes the chronologically first collection when none has a window', () => {
    expect(startCollectionFor(catalog, view, {})).toBe(10);
  });

  it('prefers a windowed collection over an earlier one without a window', () => {
    expect(startCollectionFor(catalog, view, { 20: window })).toBe(20);
  });

  it('honours a pinned start that is still in the pool', () => {
    usePrefsStore.getState().setPinnedStart(7, 30);
    expect(startCollectionFor(catalog, view, {})).toBe(30);
    // Pinned to a collection the windows exclude: the pin does not apply.
    expect(startCollectionFor(catalog, view, { 20: window })).toBe(20);
  });
});
