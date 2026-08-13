import { beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeView,
  makeViz,
} from '~/features/annotation/core/catalog/testHelpers';
import { useImageryStore } from './imagery';
import { useSessionStore } from './session';
import { EMPTY_WORKSPACE_LAYOUT, useWorkspaceStore } from './workspace';

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
const cat = buildCatalog(makeCampaign({ imagery_sources: [source] }));

beforeEach(() => {
  useSessionStore.setState({
    workMode: 'explore',
    isReviewMode: false,
    selectedViewId: null,
    taskStartCollectionId: null,
  });
  useWorkspaceStore.setState({
    currentLayout: EMPTY_WORKSPACE_LAYOUT,
    savedLayout: EMPTY_WORKSPACE_LAYOUT,
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
    useSessionStore.setState({ isReviewMode: true });
    useSessionStore.getState().setWorkMode('explore');
    expect(useSessionStore.getState().workMode).toBe('explore');
    expect(useSessionStore.getState().isReviewMode).toBe(false);
    expect(useImageryStore.getState().crosshair).toBe(false);
  });

  it('turns the crosshair on for tasks mode', () => {
    useSessionStore.getState().setWorkMode('tasks');
    expect(useImageryStore.getState().crosshair).toBe(true);
  });
});

describe('selectView', () => {
  it('updates selectedViewId and delegates the snapshot/restore to imagery.switchView', () => {
    useSessionStore.getState().selectView(makeView({ id: 1, source_ids: [1] }), cat, 10);
    expect(useSessionStore.getState().selectedViewId).toBe(1);
    expect(useSessionStore.getState().taskStartCollectionId).toBe(10);
    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 10,
      sliceIndex: 0,
      vizId: '1',
    });

    useImageryStore.setState({ showBasemap: true });
    useSessionStore.getState().selectView(makeView({ id: 2 }), cat, null);
    expect(useSessionStore.getState().selectedViewId).toBe(2);
    expect(useSessionStore.getState().taskStartCollectionId).toBeNull();
    expect(useImageryStore.getState().viewSnapshots[1]?.showBasemap).toBe(true);
  });

  it('brings the selected view its own canvas windows', () => {
    const first = makeView({
      id: 1,
      source_ids: [1],
      default_canvas_layout: layoutOut(1, [10]),
    });
    const second = makeView({ id: 2, default_canvas_layout: layoutOut(2, [20, 30]) });

    useSessionStore.getState().selectView(first, cat, 10);
    expect(Object.keys(useWorkspaceStore.getState().currentLayout.view.windows)).toEqual(['10']);

    useSessionStore.getState().selectView(second, cat, null);
    expect(Object.keys(useWorkspaceStore.getState().currentLayout.view.windows)).toEqual([
      '20',
      '30',
    ]);

    useSessionStore.getState().selectView(first, cat, 10);
    expect(Object.keys(useWorkspaceStore.getState().currentLayout.view.windows)).toEqual(['10']);
  });
});
