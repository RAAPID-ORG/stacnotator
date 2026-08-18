import { afterEach, describe, expect, it } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { buildImageryCatalog } from '../campaign/imagery';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTask,
  makeView,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { useCampaignStore } from '../stores/campaign';
import { useImageryStore } from '../stores/imagery';
import { usePrefsStore } from '../stores/prefs';
import { useWorkStore } from './work';
import { useTasksStore } from './tasks';

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

function task(id: number, annotationNumber: number, lon: number, lat: number): AnnotationTaskOut {
  return makeTask({
    id,
    annotation_number: annotationNumber,
    geometry: { id, geometry: `POINT (${lon} ${lat})` },
  });
}

const TASK_A = task(1, 1, 0, 0);
const TASK_B = task(2, 2, 10, 10);

function initialize(tasks: AnnotationTaskOut[], catalog = CATALOG): void {
  useTasksStore.getState().initialize({
    tasks,
    taskSets: [],
    filter: FILTER,
    now: 0,
    catalog,
  });
}

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
    useWorkStore.getState().addProbePoint([4, 5]);
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
    expect(useWorkStore.getState().probePoints).toEqual([]);

    useImageryStore.setState({
      address: { sourceId: 7, collectionId: 71, sliceIndex: 1, vizId: '70' },
      windowSlices: { 71: { selected: 1, userPicked: 1 } },
      empties: { '71:0': true },
    });
    useWorkStore.getState().addProbePoint([6, 7]);

    useTasksStore.getState().next(catalog);

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 7,
      collectionId: 72,
      sliceIndex: 1,
      vizId: '70',
    });
    expect(useImageryStore.getState().windowSlices).toEqual({});
    expect(useImageryStore.getState().empties).toEqual({});
    expect(useWorkStore.getState().probePoints).toEqual([]);
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
  it('outlines nothing around a point task when the campaign configures no extent', () => {
    useCampaignStore.setState({ campaign: CAMPAIGN });
    initialize([TASK_A]);

    expect(useTasksStore.getState().focus?.extent).toBeNull();
  });

  it("draws the campaign's sample extent as a square around a point task", () => {
    useCampaignStore.setState({
      campaign: makeCampaign({
        ...CAMPAIGN,
        settings: { ...CAMPAIGN.settings, sample_extent_meters: 1000 },
      }),
    });
    initialize([TASK_A]);

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

  it('outlines a footprint task with its own geometry, extent setting or not', () => {
    useCampaignStore.setState({
      campaign: makeCampaign({
        ...CAMPAIGN,
        settings: { ...CAMPAIGN.settings, sample_extent_meters: 1000 },
      }),
    });
    initialize([
      makeTask({
        id: 9,
        annotation_number: 9,
        geometry: { id: 9, geometry: 'POLYGON ((0 0, 0 1, 1 1, 1 0, 0 0))' },
      }),
    ]);

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
