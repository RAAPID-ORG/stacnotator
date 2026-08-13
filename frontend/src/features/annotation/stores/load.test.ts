import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationTaskOut, TaskSetOut } from '~/api/client';
import {
  apiSuccess,
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTask,
  makeTaskList,
  makeView,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { useLayoutStore } from './layout';
import { EMPTY_LAYOUT } from '../canvas/grid';
import { useImageryStore } from './imagery';
import { useCampaignStore } from './campaign';
import { usePrefsStore } from './prefs';
import { useTasksStore } from './tasks';
import { useWorkStore } from './work';

vi.mock('~/api/client', async (importActual) => {
  const actual = await importActual<typeof import('~/api/client')>();
  return {
    ...actual,
    getCampaignWithImageryWindows: vi.fn(),
    getAllAnnotationTasks: vi.fn(),
    listTaskSets: vi.fn(),
  };
});

import { getAllAnnotationTasks, getCampaignWithImageryWindows, listTaskSets } from '~/api/client';
import { loadCampaign } from './load';

const source = makeSource({
  id: 1,
  name: 'S1',
  visualizations: [makeViz({ id: 1, name: 'True Color' })],
  collections: [
    makeCollection({ id: 10, name: 'A', slices: [makeSlice({ id: 100, name: 's0' })] }),
  ],
});
const view = makeView({ id: 100, name: 'V1', source_ids: [1] });

const task = (overrides: Partial<AnnotationTaskOut> = {}): AnnotationTaskOut =>
  makeTask({ id: 1, geometry: { id: 1, geometry: 'POINT(0 0)' }, ...overrides });

function mockApi({
  tasks = [task()],
  taskSets = [] as TaskSetOut[],
  mode = 'tasks' as 'tasks' | 'open',
  isPublic = false,
}: {
  tasks?: AnnotationTaskOut[];
  taskSets?: TaskSetOut[];
  mode?: 'tasks' | 'open';
  isPublic?: boolean;
} = {}) {
  const campaign = makeCampaign({
    mode,
    is_public: isPublic,
    imagery_sources: [source],
    imagery_views: [view],
  });
  vi.mocked(getCampaignWithImageryWindows).mockResolvedValue(apiSuccess(campaign));
  vi.mocked(getAllAnnotationTasks).mockResolvedValue(apiSuccess(makeTaskList({ tasks })));
  vi.mocked(listTaskSets).mockResolvedValue(apiSuccess(taskSets));
  return campaign;
}

beforeEach(() => {
  vi.mocked(getCampaignWithImageryWindows).mockReset();
  vi.mocked(getAllAnnotationTasks).mockReset();
  vi.mocked(listTaskSets).mockReset();
  usePrefsStore.setState({ pinnedStart: {} });
  useCampaignStore.setState({
    workMode: 'explore',
    isReviewMode: false,
    view: null,
    taskStartCollectionId: null,
  });
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
    emptyScope: null,
  });
});

describe('loadCampaign happy path', () => {
  it('seeds session, workspace, and imagery stores from one campaign+tasks+taskSets round trip', async () => {
    const myTask = task({ assignments: [{ user_id: 'u1', status: 'pending' }] });
    mockApi({ tasks: [myTask] });

    await loadCampaign(5, { now: 1000, currentUserId: 'u1' });

    expect(getCampaignWithImageryWindows).toHaveBeenCalledWith({ path: { campaign_id: 5 } });
    expect(useTasksStore.getState().allTasks).toEqual([myTask]);
    expect(useTasksStore.getState().filter.assignedTo).toEqual(['u1']);
    expect(useTasksStore.getState().filter).toEqual(
      expect.objectContaining({ statuses: ['pending'] })
    );

    expect(useCampaignStore.getState().workMode).toBe('tasks');
    expect(useCampaignStore.getState().view?.id).toBe(100);
    expect(useCampaignStore.getState().taskStartCollectionId).toBe(10);

    expect(useImageryStore.getState().address).toEqual({
      sourceId: 1,
      collectionId: 10,
      sliceIndex: 0,
      vizId: '1',
    });
    expect(useImageryStore.getState().crosshair).toBe(true); // tasks mode
  });

  it('honours a pinned-start collection over the first window collection', async () => {
    const second = makeCollection({
      id: 20,
      name: 'B',
      slices: [makeSlice({ id: 200, name: 's0' })],
    });
    const source2 = { ...source, collections: [source.collections[0], second] };
    const campaign = makeCampaign({
      mode: 'tasks',
      imagery_sources: [source2],
      imagery_views: [view],
    });
    vi.mocked(getCampaignWithImageryWindows).mockResolvedValue(apiSuccess(campaign));
    vi.mocked(getAllAnnotationTasks).mockResolvedValue(
      apiSuccess(makeTaskList({ tasks: [task()] }))
    );
    vi.mocked(listTaskSets).mockResolvedValue(apiSuccess([]));

    usePrefsStore.getState().setPinnedStart(100, 20);

    await loadCampaign(5, { now: 1000, currentUserId: 'u1' });
    expect(useImageryStore.getState().address?.collectionId).toBe(20);
  });

  it('stages a deep-linked annotation id only in explore mode', async () => {
    mockApi({ mode: 'open', tasks: [] });
    const result = await loadCampaign(5, {
      now: 1000,
      currentUserId: 'u1',
      annotationId: 42,
    });
    expect(useCampaignStore.getState().workMode).toBe('explore');
    expect(result.annotationId).toBe(42);
  });

  it('does not stage a deep-linked annotation id in tasks mode', async () => {
    mockApi({ mode: 'tasks', tasks: [task()] });
    const result = await loadCampaign(5, {
      now: 1000,
      currentUserId: 'u1',
      workMode: 'tasks',
      annotationId: 42,
    });
    expect(result.annotationId).toBeNull();
  });

  it('lands a zero-task tasks-mode campaign in explore instead', async () => {
    mockApi({ mode: 'tasks', tasks: [] });
    await loadCampaign(5, { now: 1000, currentUserId: 'u1' });
    expect(useCampaignStore.getState().workMode).toBe('explore');
    expect(useCampaignStore.getState().isReviewMode).toBe(false);
    expect(useTasksStore.getState().allTasks).toEqual([]);
  });

  it('respects an explicit initialWorkMode even for a zero-task campaign', async () => {
    mockApi({ mode: 'tasks', tasks: [] });
    await loadCampaign(5, { now: 1000, currentUserId: 'u1', workMode: 'tasks' });
    expect(useCampaignStore.getState().workMode).toBe('tasks');
  });
});

// A campaign switch is a whole new page: a shape half-drawn on campaign A's map
// must not still be open (and committable) over campaign B's.
describe('loadCampaign clears the previous campaign', () => {
  it('leaves no draft, no answers and no selection behind', async () => {
    mockApi();
    const work = useWorkStore.getState();
    work.beginDraft(1);
    work.editDraftGeometry({ type: 'Point', coordinates: [0, 0] });
    work.setComment('half-written note');
    work.setFormValues({ '1': 'answer' });
    work.setSelection([11, 12]);

    await loadCampaign(6, { now: 1000, currentUserId: 'u1' });

    const after = useWorkStore.getState();
    expect(after.draft.phase).toBe('idle');
    expect(after.comment).toBe('');
    expect(after.formValues).toEqual({});
    expect(after.selectedLabelId).toBeNull();
    expect(after.selection).toEqual([]);
    expect(after.edit).toBeNull();
  });
});
