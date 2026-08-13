import { afterEach, describe, expect, it } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTask,
  makeViz,
} from '~/features/annotation/core/catalog/testHelpers';
import { useImageryStore, usePrefsStore, useSessionStore } from '~/features/annotation/stores';
import { getMapFocus } from '~/features/annotation/shared/mapFocus';
import { setProbePoint, useInteractionSpec } from '~/features/annotation/shared/interactionSpec';
import {
  goToAnnotationNumber,
  initTaskList,
  next,
  previous,
  getTaskListState,
  replaceTask,
  resetTaskList,
  setKnnValidationEnabled,
  syncMapFocus,
} from './taskListBus';

const CAMPAIGN = makeCampaign({
  imagery_sources: [
    makeSource({
      id: 1,
      name: 'Sentinel',
      crosshair_hex6: 'ff0000',
      visualizations: [makeViz({ id: 1 })],
      collections: [makeCollection({ id: 1, slices: [makeSlice({ id: 10 })] })],
    }),
  ],
});
const CATALOG = buildCatalog(CAMPAIGN);
const FILTER = {
  assignedTo: [],
  statuses: ['pending' as const],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

function task(id: number, annotationNumber: number, lon: number, lat: number): AnnotationTaskOut {
  return makeTask({
    id,
    annotation_number: annotationNumber,
    geometry: { id, geometry: `POINT (${lon} ${lat})` },
  });
}

const TASK_A = task(1, 1, 0, 0);
const TASK_B = task(2, 2, 10, 10);

afterEach(() => {
  resetTaskList();
  useImageryStore.setState({ address: null, emptyScope: null });
  usePrefsStore.setState({ pinnedStart: {} });
  useSessionStore.setState({ selectedViewId: null, taskStartCollectionId: null });
});

describe('taskListBus KNN validation toggle', () => {
  it('starts off', () => {
    expect(getTaskListState().knnValidationEnabled).toBe(false);
  });

  it('resets back off after the user turned it on', () => {
    setKnnValidationEnabled(true);
    expect(getTaskListState().knnValidationEnabled).toBe(true);

    resetTaskList();
    expect(getTaskListState().knnValidationEnabled).toBe(false);
  });
});

describe('taskListBus map focus', () => {
  it('next() and previous() push the new current task location into shared/mapFocus', () => {
    useImageryStore
      .getState()
      .setAddress({ sourceId: 1, collectionId: 1, sliceIndex: 0, vizId: '1' });
    initTaskList([TASK_A, TASK_B], [], FILTER, 'u1', 0);
    syncMapFocus(CATALOG); // what the panel's initial-load effect does

    expect(getMapFocus()?.center).toEqual([0, 0]);
    expect(getMapFocus()?.crosshairColor).toBe('#ff0000');

    next(CATALOG);
    expect(getMapFocus()?.center).toEqual([10, 10]);

    previous(CATALOG);
    expect(getMapFocus()?.center).toEqual([0, 0]);
  });

  it('carries the centres of the tasks after this one, which is what the preloader fetches ahead', () => {
    initTaskList([TASK_A, TASK_B], [], FILTER, 'u1', 0);
    syncMapFocus(CATALOG);

    expect(getMapFocus()?.upcoming).toEqual([[10, 10]]);

    next(CATALOG);
    expect(getMapFocus()?.upcoming).toEqual([]);
  });

  it('goToAnnotationNumber() updates the focus to the jumped-to task', () => {
    initTaskList([TASK_A, TASK_B], [], FILTER, 'u1', 0);

    goToAnnotationNumber(2, CATALOG);

    expect(getMapFocus()?.center).toEqual([10, 10]);
  });

  it('opens each new task on the collection starred for the selected view', () => {
    const source = makeSource({
      id: 7,
      visualizations: [makeViz({ id: 70, name: 'rgb' })],
      collections: [
        makeCollection({ id: 71, slices: [makeSlice({ id: 710 })] }),
        makeCollection({ id: 72, slices: [makeSlice({ id: 720 })] }),
      ],
    });
    const catalog = buildCatalog(makeCampaign({ imagery_sources: [source] }));
    useImageryStore.setState({
      address: { sourceId: 7, collectionId: 71, sliceIndex: 0, vizId: '70' },
      emptyScope: null,
    });
    useSessionStore.setState({ selectedViewId: 9, taskStartCollectionId: 72 });
    usePrefsStore.setState({ pinnedStart: { 9: 72 } });
    initTaskList([TASK_A, TASK_B], [], FILTER, 'u1', 0);

    syncMapFocus(catalog);
    expect(useImageryStore.getState().address?.collectionId).toBe(72);

    useImageryStore.getState().setActiveCollection(catalog, 71);
    replaceTask({ ...TASK_A, task_status: 'done' }, catalog);
    expect(useImageryStore.getState().address?.collectionId).toBe(71);

    next(catalog);
    expect(useImageryStore.getState().address?.collectionId).toBe(72);
  });

  it('resets task-scoped imagery choices to the starred collection and its cover slice', () => {
    const source = makeSource({
      id: 7,
      visualizations: [makeViz({ id: 70, name: 'rgb' })],
      collections: [
        makeCollection({
          id: 71,
          cover_slice_index: 0,
          slices: [makeSlice({ id: 710 }), makeSlice({ id: 711 })],
        }),
        makeCollection({
          id: 72,
          cover_slice_index: 1,
          slices: [makeSlice({ id: 720 }), makeSlice({ id: 721 })],
        }),
      ],
    });
    const catalog = buildCatalog(makeCampaign({ imagery_sources: [source] }));
    useImageryStore.setState({
      address: { sourceId: 7, collectionId: 71, sliceIndex: 1, vizId: '70' },
      windowSlices: { 71: { selected: 1, userPicked: 1 } },
      empties: { '71:0': true },
      viewSnapshots: {
        9: {
          address: { sourceId: 7, collectionId: 71, sliceIndex: 1, vizId: '70' },
          showBasemap: false,
          selectedBasemapId: null,
          overlay: { id: null, visible: true },
          overlayOpacity: 1,
          vector: { id: null, visible: true },
        },
      },
      emptyScope: null,
    });
    useSessionStore.setState({ selectedViewId: 9, taskStartCollectionId: 72 });
    usePrefsStore.setState({ pinnedStart: { 9: 72 } });
    setProbePoint([4, 5]);
    initTaskList([TASK_A, TASK_B], [], FILTER, 'u1', 0);

    syncMapFocus(catalog);

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 7,
      collectionId: 72,
      sliceIndex: 1,
      vizId: '70',
    });
    expect(useImageryStore.getState().windowSlices).toEqual({});
    expect(useImageryStore.getState().empties).toEqual({});
    expect(useImageryStore.getState().viewSnapshots).toEqual({});
    expect(useInteractionSpec.getState().probePoint).toBeNull();

    useImageryStore.setState({
      address: { sourceId: 7, collectionId: 71, sliceIndex: 1, vizId: '70' },
      windowSlices: { 71: { selected: 1, userPicked: 1 } },
      empties: { '71:0': true },
    });
    setProbePoint([6, 7]);

    next(catalog);

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 7,
      collectionId: 72,
      sliceIndex: 1,
      vizId: '70',
    });
    expect(useImageryStore.getState().windowSlices).toEqual({});
    expect(useImageryStore.getState().empties).toEqual({});
    expect(useInteractionSpec.getState().probePoint).toBeNull();
  });

  it('replaceTask() re-syncs the focus for the (possibly still current) task', () => {
    initTaskList([TASK_A, TASK_B], [], FILTER, 'u1', 0);

    replaceTask({ ...TASK_A, task_status: 'done' }, CATALOG);

    expect(getMapFocus()?.center).toEqual([0, 0]);
  });

  it('next() past the last task clears the focus once nothing is visible', () => {
    initTaskList([TASK_A], [], FILTER, 'u1', 0);
    syncMapFocus(CATALOG);
    expect(getMapFocus()).not.toBeNull();

    initTaskList([], [], FILTER, 'u1', 0);
    syncMapFocus(CATALOG);
    expect(getMapFocus()).toBeNull();
  });
});
