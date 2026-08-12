import { afterEach, describe, expect, it } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import { makeCampaign, makeSource, makeTask } from '~/features/annotation/core/catalog/testHelpers';
import { useImageryStore } from '~/features/annotation/stores';
import { getMapFocus } from '~/features/annotation/panels/shared/mapFocus';
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
  imagery_sources: [makeSource({ id: 1, name: 'Sentinel', crosshair_hex6: 'ff0000' })],
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
  useImageryStore.getState().setAddress(null);
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
