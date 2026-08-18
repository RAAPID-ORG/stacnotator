import { beforeEach, describe, expect, it } from 'vitest';
import { buildImageryCatalog } from '../campaign/imagery';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { useImageryStore } from './imagery';

const source = makeSource({
  id: 1,
  name: 'S1',
  visualizations: [makeViz({ id: 1, name: 'True Color' })],
  collections: [
    makeCollection({ id: 10, name: 'A', slices: [makeSlice({ id: 100, name: 's0' })] }),
    makeCollection({
      id: 20,
      name: 'B',
      slices: [makeSlice({ id: 200, name: 's0' }), makeSlice({ id: 201, name: 's1' })],
    }),
  ],
});
const campaign = makeCampaign({ imagery_sources: [source] });
const cat = buildImageryCatalog(campaign);

beforeEach(() => {
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
    windowSlices: {},
    emptyScope: null,
  });
});

describe('setAddress / markEmpty', () => {
  it('sets the address directly', () => {
    useImageryStore
      .getState()
      .setAddress({ sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1' });
    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 10,
      sliceIndex: 0,
      vizId: '1',
    });
  });

  it('keeps empty results within one task location', () => {
    useImageryStore.getState().setEmptyScope('task:1');
    useImageryStore.getState().markEmpty(10, 0);
    useImageryStore.getState().setEmptyScope('task:1');
    expect(useImageryStore.getState().empties).toEqual({ '10:0': true });

    useImageryStore.getState().setEmptyScope('task:2');
    expect(useImageryStore.getState().empties).toEqual({});
  });

  it('marks a slice empty, no-op when already marked (same reference)', () => {
    useImageryStore.getState().markEmpty(10, 0);
    const empties = useImageryStore.getState().empties;
    expect(empties).toEqual({ '10:0': true });
    useImageryStore.getState().markEmpty(10, 0);
    expect(useImageryStore.getState().empties).toBe(empties);
  });
});

describe('activateCollection', () => {
  it('lands on the cover without window memory and keeps overlay/vector/empties', () => {
    useImageryStore.setState({
      showBasemap: true,
      overlay: { id: 5, visible: true },
      vector: { id: 9, visible: false },
      empties: { '20:0': true },
    });
    useImageryStore.getState().activateCollection(cat, 10);
    const s = useImageryStore.getState();
    expect(s.address).toEqual({ sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1' });
    expect(s.showBasemap).toBe(false);
    expect(s.overlay).toEqual({ id: 5, visible: true });
    expect(s.vector).toEqual({ id: 9, visible: false });
    expect(s.empties).toEqual({ '20:0': true });
  });

  it('restores the slice previously selected in the target imagery window', () => {
    useImageryStore
      .getState()
      .setAddress({ sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1' });
    useImageryStore.getState().rememberWindowSlice(20, 1, true);

    useImageryStore.getState().activateCollection(cat, 20);

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 20,
      sliceIndex: 1,
      vizId: '1',
    });
  });

  it('restores the target window slice when stepping to the next collection', () => {
    useImageryStore
      .getState()
      .setAddress({ sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1' });
    useImageryStore.getState().rememberWindowSlice(20, 1, true);

    useImageryStore.getState().stepCollectionAction(cat, 1);

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 20,
      sliceIndex: 1,
      vizId: '1',
    });
  });
});

describe('resetForTask', () => {
  it('clears window memory and deliberately returns to the configured collection cover', () => {
    useImageryStore.setState({
      address: { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1' },
      windowSlices: { 20: { selected: 1, userPicked: 1 } },
    });

    useImageryStore.getState().resetForTask(cat, 20, 'task:2');

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 20,
      sliceIndex: 0,
      vizId: '1',
    });
    expect(useImageryStore.getState().windowSlices).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// activateCollection: per-source visualization memory. False Color is
// published on Jan and Mar, but not on Feb - Feb proves the fallback.
// ---------------------------------------------------------------------------

const sourceMV = makeSource({
  id: 2,
  name: 'S2',
  visualizations: [
    makeViz({ id: 21, name: 'True Color' }),
    makeViz({ id: 22, name: 'False Color' }),
  ],
  collections: [
    makeCollection({
      id: 210,
      name: 'Jan',
      slices: [
        makeSlice({
          id: 2100,
          name: 's0',
          tile_urls: [
            makeTileUrl({ visualization_name: 'True Color' }),
            makeTileUrl({ visualization_name: 'False Color' }),
          ],
        }),
      ],
    }),
    makeCollection({
      id: 220,
      name: 'Feb',
      slices: [
        makeSlice({
          id: 2200,
          name: 's0',
          tile_urls: [makeTileUrl({ visualization_name: 'True Color' })],
        }),
      ],
    }),
    makeCollection({
      id: 230,
      name: 'Mar',
      slices: [
        makeSlice({
          id: 2300,
          name: 's0',
          tile_urls: [
            makeTileUrl({ visualization_name: 'True Color' }),
            makeTileUrl({ visualization_name: 'False Color' }),
          ],
        }),
      ],
    }),
  ],
});
const campaignMV = makeCampaign({ imagery_sources: [sourceMV] });
const catMV = buildImageryCatalog(campaignMV);

describe('activateCollection: per-source visualization memory', () => {
  it('keeps the current visualization when switching to a collection in the same source', () => {
    useImageryStore
      .getState()
      .setAddress({ sourceId: 2, collectionId: 210, sliceIndex: 0, vizId: '22' });
    useImageryStore.getState().activateCollection(catMV, 230);
    expect(useImageryStore.getState().address).toEqual({
      sourceId: 2,
      collectionId: 230,
      sliceIndex: 0,
      vizId: '22',
    });
  });

  it("falls back to the source's first visualization when the remembered one is not published on the target's cover slice", () => {
    useImageryStore
      .getState()
      .setAddress({ sourceId: 2, collectionId: 210, sliceIndex: 0, vizId: '22' });
    useImageryStore.getState().activateCollection(catMV, 220);
    expect(useImageryStore.getState().address).toEqual({
      sourceId: 2,
      collectionId: 220,
      sliceIndex: 0,
      vizId: '21',
    });
  });
});

// ---------------------------------------------------------------------------
// switchView: snapshot/restore round trip, including vector + basemap fields.
// ---------------------------------------------------------------------------

describe('switchView', () => {
  it('round-trips vector + basemap selection across a view switch and back', () => {
    // First entry to view 1: nothing saved yet, falls back to collection 10's cover.
    useImageryStore.getState().switchView(cat, null, 1, 10);
    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 10,
      sliceIndex: 0,
      vizId: '1',
    });

    // User changes basemap + vector layer while on view 1.
    useImageryStore.setState({
      showBasemap: true,
      selectedBasemapId: 'basemap-5',
      vector: { id: 3, visible: false },
    });

    // Switch to view 2: view 1's mutated state is snapshotted; view 2 gets a
    // fresh default at collection 20.
    useImageryStore.getState().switchView(cat, 1, 2, 20);
    const view2 = useImageryStore.getState();
    expect(view2.address).toEqual({ sourceId: 1, collectionId: 20, sliceIndex: 0, vizId: '1' });
    expect(view2.showBasemap).toBe(false);
    expect(view2.selectedBasemapId).toBeNull();
    expect(view2.vector).toEqual({ id: null, visible: true });

    // Switch back to view 1: its exact previous basemap + vector selection returns.
    useImageryStore.getState().switchView(cat, 2, 1, 10);
    const view1 = useImageryStore.getState();
    expect(view1.address).toEqual({ sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1' });
    expect(view1.showBasemap).toBe(true);
    expect(view1.selectedBasemapId).toBe('basemap-5');
    expect(view1.vector).toEqual({ id: 3, visible: false });
  });

  it('does not snapshot when fromViewId is null (first switch of a session)', () => {
    useImageryStore.getState().switchView(cat, null, 1, 10);
    expect(useImageryStore.getState().viewSnapshots).toEqual({});
  });

  it('leaves crosshair/showAnnotations/viewSync untouched across a switch (app-wide, not per-view)', () => {
    useImageryStore.setState({ crosshair: false, showAnnotations: false, viewSync: false });
    useImageryStore.getState().switchView(cat, null, 1, 10);
    const s = useImageryStore.getState();
    expect(s.crosshair).toBe(false);
    expect(s.showAnnotations).toBe(false);
    expect(s.viewSync).toBe(false);
  });
});
