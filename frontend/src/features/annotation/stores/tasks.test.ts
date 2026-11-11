import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTaskDetails, type TaskOut } from '~/api/client';
import { taskRowFromTaskOut, type TaskRow } from '~/shared/utils/taskSummary';
import { buildImageryCatalog } from '../campaign/imagery';
import { computeTaskProgress } from '../campaign/tasks';
import {
  apiSuccess,
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTask,
  makeTaskRowAnswer,
  makeView,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { useCampaignStore } from '../stores/campaign';
import { useImageryStore } from '../stores/imagery';
import { usePrefsStore } from '../stores/prefs';
import { useWorkStore } from './work';
import { currentTaskDetails, useTasksStore } from './tasks';

vi.mock('~/api/client', async (importActual) => ({
  ...(await importActual<typeof import('~/api/client')>()),
  getTaskDetails: vi.fn(),
}));

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
const CATALOG = buildImageryCatalog(CAMPAIGN);
const FILTER = {
  assignedTo: [],
  statuses: ['pending' as const],
  selectedLabelIds: [],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

/** What `getTaskDetails` answers with, by task id. */
const DETAILS = new Map<number, TaskOut>();

function task(
  id: number,
  annotationNumber: number,
  lon: number,
  lat: number,
  geometryWkt = `POINT (${lon} ${lat})`
): TaskRow {
  const details = makeTask({ id, annotation_number: annotationNumber, geometry_wkt: geometryWkt });
  DETAILS.set(id, details);
  return taskRowFromTaskOut(details);
}

const detailsOf = (row: TaskRow): TaskOut => {
  const details = DETAILS.get(row.id);
  if (!details) throw new Error(`no details for task ${row.id}`);
  return details;
};

const detailsArrived = () => vi.waitFor(() => expect(currentTaskDetails()).not.toBeNull());

const TASK_A = task(1, 1, 0, 0);
const TASK_B = task(2, 2, 10, 10);

function initialize(tasks: TaskRow[], catalog = CATALOG): void {
  useTasksStore.getState().initialize({
    tasks,
    taskSets: [],
    syncCursor: null,
    filter: FILTER,
    now: 0,
    catalog,
  });
}

beforeEach(() => {
  vi.mocked(getTaskDetails).mockReset();
  vi.mocked(getTaskDetails).mockImplementation(async ({ query }) =>
    apiSuccess({
      campaign_id: CAMPAIGN.id,
      tasks: (query?.ids ?? []).flatMap((id) => DETAILS.get(id) ?? []),
    })
  );
});

afterEach(() => {
  useTasksStore.getState().reset();
  useCampaignStore.setState({ campaign: null });
  useImageryStore.setState({ address: null, emptyScope: null });
  usePrefsStore.setState({ pinnedStart: {} });
  useCampaignStore.setState({ view: null, taskStartCollectionId: null });
});

describe('task session KNN validation toggle', () => {
  it('starts off', () => {
    expect(useTasksStore.getState().knnValidationEnabled).toBe(false);
  });

  it('resets back off after the user turned it on', () => {
    useTasksStore.getState().setKnnValidationEnabled(true);
    expect(useTasksStore.getState().knnValidationEnabled).toBe(true);

    useTasksStore.getState().reset();
    expect(useTasksStore.getState().knnValidationEnabled).toBe(false);
  });
});

describe('task session map focus', () => {
  it('centres on the summary at once and takes the polygon for time series once details arrive', async () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    const polygonTask = task(
      5,
      5,
      1,
      1,
      'POLYGON ((0 0, 2 0, 2 2, 0 2, 0 0), (0.5 0.5, 0.5 1.5, 1.5 1.5, 1.5 0.5, 0.5 0.5))'
    );
    initialize([polygonTask, TASK_B]);

    const before = useTasksStore.getState().focus!;
    expect(before.center).toEqual([1, 1]);
    expect(before.extent).toBeNull();
    expect(before.timeseriesLocation).toBeNull();
    expect(before.upcomingTimeseriesLocations).toEqual([]);

    await detailsArrived();
    const after = useTasksStore.getState().focus!;
    expect(after.center).toEqual([1, 1]);
    expect(after.upcomingTimeseriesLocations).toEqual([{ lat: 10, lon: 10 }]);
    expect(after.extent?.geometry.type).toBe('Polygon');
    expect(after.timeseriesLocation).toMatchObject({
      type: 'Polygon',
      coordinates: expect.arrayContaining([
        [
          [0.5, 0.5],
          [0.5, 1.5],
          [1.5, 1.5],
          [1.5, 0.5],
          [0.5, 0.5],
        ],
      ]),
    });
  });

  it('locates a point task where it was prefetched as an upcoming one', async () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    initialize([TASK_A, TASK_B]);
    await detailsArrived();
    const upcoming = useTasksStore.getState().focus!.upcomingTimeseriesLocations[0];

    useTasksStore.getState().next(CATALOG);

    expect(useTasksStore.getState().focus?.timeseriesLocation).toEqual(upcoming);
  });

  it('next() and previous() push the new current task location into shared/mapFocus', () => {
    useImageryStore
      .getState()
      .setAddress({ sourceId: 1, collectionId: 1, sliceIndex: 0, vizId: '1' });
    initialize([TASK_A, TASK_B]);

    expect(useTasksStore.getState().focus?.center).toEqual([0, 0]);
    expect(useTasksStore.getState().focus?.crosshairColor).toBe('#ff0000');

    useTasksStore.getState().next(CATALOG);
    expect(useTasksStore.getState().focus?.center).toEqual([10, 10]);

    useTasksStore.getState().previous(CATALOG);
    expect(useTasksStore.getState().focus?.center).toEqual([0, 0]);
  });

  it('carries the centres of the tasks after this one, which is what the preloader fetches ahead', () => {
    initialize([TASK_A, TASK_B]);

    expect(useTasksStore.getState().focus?.upcoming).toEqual([[10, 10]]);

    useTasksStore.getState().next(CATALOG);
    expect(useTasksStore.getState().focus?.upcoming).toEqual([]);
  });

  it('goToAnnotationNumber() updates the focus to the jumped-to task', () => {
    initialize([TASK_A, TASK_B]);

    useTasksStore.getState().goToAnnotationNumber(2, CATALOG);

    expect(useTasksStore.getState().focus?.center).toEqual([10, 10]);
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
    const catalog = buildImageryCatalog(makeCampaign({ imagery_sources: [source] }));
    useImageryStore.setState({
      address: { sourceId: 7, collectionId: 71, sliceIndex: 0, vizId: '70' },
      emptyScope: null,
    });
    useCampaignStore.setState({ view: makeView({ id: 9 }), taskStartCollectionId: 72 });
    usePrefsStore.setState({ pinnedStart: { 9: 72 } });
    initialize([TASK_A, TASK_B], catalog);
    expect(useImageryStore.getState().address?.collectionId).toBe(72);

    useImageryStore.getState().activateCollection(catalog, 71);
    useTasksStore.getState().replaceTask({ ...TASK_A, task_status: 'done' }, catalog);
    expect(useImageryStore.getState().address?.collectionId).toBe(71);

    useTasksStore.getState().next(catalog);
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
    const catalog = buildImageryCatalog(makeCampaign({ imagery_sources: [source] }));
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
    useCampaignStore.setState({ view: makeView({ id: 9 }), taskStartCollectionId: 72 });
    usePrefsStore.setState({ pinnedStart: { 9: 72 } });
    useWorkStore.getState().probeAt([4, 5]);
    initialize([TASK_A, TASK_B], catalog);

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 7,
      collectionId: 72,
      sliceIndex: 1,
      vizId: '70',
    });
    expect(useImageryStore.getState().windowSlices).toEqual({});
    expect(useImageryStore.getState().empties).toEqual({});
    expect(useImageryStore.getState().viewSnapshots).toEqual({});
    expect(useWorkStore.getState().probes).toEqual([]);

    useImageryStore.setState({
      address: { sourceId: 7, collectionId: 71, sliceIndex: 1, vizId: '70' },
      windowSlices: { 71: { selected: 1, userPicked: 1 } },
      empties: { '71:0': true },
    });
    useWorkStore.getState().probeAt([6, 7]);

    useTasksStore.getState().next(catalog);

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 7,
      collectionId: 72,
      sliceIndex: 1,
      vizId: '70',
    });
    expect(useImageryStore.getState().windowSlices).toEqual({});
    expect(useImageryStore.getState().empties).toEqual({});
    expect(useWorkStore.getState().probes).toEqual([]);
  });

  it('replaceTask() re-syncs the focus for the (possibly still current) task', () => {
    initialize([TASK_A, TASK_B]);

    useTasksStore.getState().replaceTask({ ...TASK_A, task_status: 'done' }, CATALOG);

    expect(useTasksStore.getState().focus?.center).toEqual([0, 0]);
  });

  it('next() past the last task clears the focus once nothing is visible', () => {
    initialize([TASK_A]);
    expect(useTasksStore.getState().focus).not.toBeNull();

    initialize([]);
    expect(useTasksStore.getState().focus).toBeNull();
  });
});

describe('task session sample extent', () => {
  it('outlines nothing around a point task when the campaign configures no extent', async () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    initialize([TASK_A]);
    await detailsArrived();

    expect(useTasksStore.getState().focus?.extent).toBeNull();
  });

  it("draws the campaign's sample extent as a square around a point task", async () => {
    useCampaignStore.setState({
      campaign: makeCampaign({
        ...CAMPAIGN,
        settings: { ...CAMPAIGN.settings, sample_extent_meters: 1000 },
      }),
    });
    initialize([TASK_A]);
    await detailsArrived();

    const geometry = useTasksStore.getState().focus?.extent?.geometry;
    expect(geometry?.type).toBe('Polygon');
    const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : [];
    expect(ring).toHaveLength(5);
    // 1km square on the equator: half a side is ~0.00449 degrees either way.
    expect(ring[0][0]).toBeCloseTo(-0.00449, 5);
    expect(ring[0][1]).toBeCloseTo(-0.00449, 5);
    expect(ring[2][0]).toBeCloseTo(0.00449, 5);
    expect(ring[2][1]).toBeCloseTo(0.00449, 5);
  });

  it('outlines a footprint task with its own geometry, extent setting or not', async () => {
    useCampaignStore.setState({
      campaign: makeCampaign({
        ...CAMPAIGN,
        settings: { ...CAMPAIGN.settings, sample_extent_meters: 1000 },
      }),
    });
    initialize([task(9, 9, 0.5, 0.5, 'POLYGON ((0 0, 0 1, 1 1, 1 0, 0 0))')]);
    await detailsArrived();

    expect(useTasksStore.getState().focus?.extent?.geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    });
  });
});

describe('task session remote progress', () => {
  it("mergeTasks() counts another annotator's work without moving the current task", () => {
    initialize([TASK_A, TASK_B]);
    const TASK_C = task(3, 3, 20, 20);

    useTasksStore.getState().mergeTasks(
      [
        { ...TASK_B, task_status: 'done' },
        { ...TASK_C, task_status: 'done' },
      ],
      CATALOG
    );

    const state = useTasksStore.getState();
    expect(computeTaskProgress(state.allTasks, [])).toEqual({ total: 3, completed: 2 });
    expect(state.visibleTasks.map((t) => t.id)).toEqual([1, 2]);
    expect(state.visibleTasks[state.currentIndex].id).toBe(1);
  });

  it('removeTasks() drops a task deleted elsewhere and moves on from it when current', () => {
    const TASK_C = task(3, 3, 20, 20);
    initialize([TASK_A, TASK_B, TASK_C]);

    useTasksStore.getState().removeTasks([1], CATALOG);

    const state = useTasksStore.getState();
    expect(state.allTasks.map((t) => t.id)).toEqual([2, 3]);
    expect(state.visibleTasks[state.currentIndex].id).toBe(2);
  });
});

describe('the session trail', () => {
  const TASK_C = task(3, 3, 20, 20);
  const current = () => {
    const s = useTasksStore.getState();
    return s.visibleTasks[s.currentIndex]?.id;
  };
  const done = (t: TaskRow): TaskRow => ({ ...t, task_status: 'done' });

  afterEach(() => useTasksStore.getState().reset());

  it('goes back to a task the filter dropped once it was finished', () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    initialize([TASK_A, TASK_B, TASK_C]);
    const store = useTasksStore.getState();
    store.replaceTask(done(TASK_A), CATALOG);
    // The pool hands out B and re-filters; A is done and drops out.
    store.adoptTask(detailsOf(TASK_B), CATALOG);
    expect(useTasksStore.getState().visibleTasks.map((t) => t.id)).toEqual([2, 3]);

    useTasksStore.getState().previous(CATALOG);
    expect(current()).toBe(1);
    expect(useTasksStore.getState().visibleTasks[0].task_status).toBe('done');

    useTasksStore.getState().next(CATALOG);
    expect(current()).toBe(2);
    // At the trail's end, next is the list's next task again.
    useTasksStore.getState().next(CATALOG);
    expect(current()).toBe(3);
  });

  it('walks several steps back and forward again', () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    initialize([TASK_A, TASK_B, TASK_C]);
    const { next, previous } = useTasksStore.getState();
    next(CATALOG);
    next(CATALOG);
    previous(CATALOG);
    previous(CATALOG);
    expect(current()).toBe(1);
    expect(useTasksStore.getState().historyPos).toBe(0);
    expect(useTasksStore.getState().forward(CATALOG)).toBe(true);
    expect(current()).toBe(2);

    useTasksStore.getState().latest(CATALOG);
    expect(current()).toBe(3);
    expect(useTasksStore.getState().forward(CATALOG)).toBe(false);
  });

  it('opening another task while back drops what lay ahead', () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    initialize([TASK_A, TASK_B, TASK_C]);
    useTasksStore.getState().next(CATALOG);
    useTasksStore.getState().previous(CATALOG);
    useTasksStore.getState().goToAnnotationNumber(3, CATALOG);
    expect(useTasksStore.getState().history).toEqual([1, 3]);
  });

  it('stepping back past the trail start keeps forward leading through it', () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    useTasksStore.getState().initialize({
      tasks: [TASK_A, TASK_B, TASK_C],
      taskSets: [],
      syncCursor: null,
      filter: FILTER,
      now: 0,
      catalog: CATALOG,
      preferTaskId: TASK_B.id,
    });
    useTasksStore.getState().previous(CATALOG);
    expect(current()).toBe(1);
    useTasksStore.getState().next(CATALOG);
    expect(current()).toBe(2);
  });

  it('does not wrap to the last task when stepping back from the first', () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    initialize([TASK_A, TASK_B, TASK_C]);
    useTasksStore.getState().previous(CATALOG);
    expect(current()).toBe(1);
  });

  it('does not walk back into tasks a changed filter excludes', () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    initialize([TASK_A, TASK_B, { ...TASK_C, task_status: 'done' }]);
    useTasksStore.getState().next(CATALOG);
    useTasksStore.getState().setFilter({ ...FILTER, statuses: ['done'] }, 0, CATALOG);
    expect(current()).toBe(3);

    useTasksStore.getState().previous(CATALOG);
    expect(current()).toBe(3);
    expect(useTasksStore.getState().visibleTasks.map((t) => t.id)).toEqual([3]);
  });
});

describe('the current task details', () => {
  beforeEach(() => useCampaignStore.setState({ campaign: CAMPAIGN }));

  it('ignores a response that a newer request for the same task has overtaken', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = { ...detailsOf(TASK_A), annotations: [] };
    vi.mocked(getTaskDetails).mockImplementationOnce(async () => {
      await held;
      return apiSuccess({ campaign_id: CAMPAIGN.id, tasks: [stale] });
    });
    initialize([TASK_A, TASK_B]);
    const answered = {
      ...TASK_A,
      annotations: [makeTaskRowAnswer({ id: 30, created_by_user_id: 'u2' })],
    };
    useTasksStore.getState().mergeTasks([answered], CATALOG);
    await detailsArrived();

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(currentTaskDetails()).toBe(detailsOf(TASK_A));
  });

  it('has the next task ready from the prefetch, without asking again', async () => {
    initialize([TASK_A, TASK_B]);
    await detailsArrived();
    const fetches = vi.mocked(getTaskDetails).mock.calls.length;

    useTasksStore.getState().next(CATALOG);

    expect(currentTaskDetails()).toBe(detailsOf(TASK_B));
    expect(vi.mocked(getTaskDetails).mock.calls.length).toBe(fetches);
  });

  it('fetches them again when a merge changes the answers, not when a claim changes hands', async () => {
    initialize([TASK_A, TASK_B]);
    await detailsArrived();
    const fetches = () => vi.mocked(getTaskDetails).mock.calls.length;
    const before = fetches();

    useTasksStore.getState().mergeTasks([{ ...TASK_A, claimed_by_user_id: 'u2' }], CATALOG);
    expect(fetches()).toBe(before);

    const answered = {
      ...TASK_A,
      annotations: [makeTaskRowAnswer({ id: 30, created_by_user_id: 'u2' })],
    };
    useTasksStore.getState().mergeTasks([answered], CATALOG);
    expect(fetches()).toBe(before + 1);
  });

  it('takes a claimed task as its own details without asking for them', () => {
    initialize([TASK_A]);
    const fetches = vi.mocked(getTaskDetails).mock.calls.length;

    useTasksStore.getState().adoptTask(detailsOf(TASK_B), CATALOG);

    expect(currentTaskDetails()).toBe(detailsOf(TASK_B));
    expect(vi.mocked(getTaskDetails).mock.calls.length).toBe(fetches);
  });
});
