import { beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeViz,
} from '~/features/annotation/core/catalog/testHelpers';
import { useImageryStore } from './imagery';
import { useSessionStore } from './session';

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
  useSessionStore.setState({ workMode: 'explore', isReviewMode: false, selectedViewId: null });
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

describe('activateCollection', () => {
  it('delegates to imagery.setActiveCollection', () => {
    useSessionStore.getState().activateCollection(10, cat);
    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 10,
      sliceIndex: 0,
      vizId: '1',
    });
  });
});

describe('selectView', () => {
  it('updates selectedViewId and delegates the snapshot/restore to imagery.switchView', () => {
    useSessionStore.getState().selectView(1, cat, 10);
    expect(useSessionStore.getState().selectedViewId).toBe(1);
    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 10,
      sliceIndex: 0,
      vizId: '1',
    });

    useImageryStore.setState({ showBasemap: true });
    useSessionStore.getState().selectView(2, cat, null);
    expect(useSessionStore.getState().selectedViewId).toBe(2);
    expect(useImageryStore.getState().viewSnapshots[1]?.showBasemap).toBe(true);
  });
});
