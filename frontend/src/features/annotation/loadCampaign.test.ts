import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskSetOut } from '~/api/client';
import type { TaskRow } from '~/shared/utils/taskSummary';
import {
  apiSuccess,
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTaskRow,
  makeTaskSummary,
  type TaskRowOverrides,
  makeView,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { useLayoutStore } from './stores/layout';
import { EMPTY_LAYOUT } from './canvas/grid';
import { useImageryStore } from './stores/imagery';
import { useCampaignStore } from './stores/campaign';
import { usePrefsStore } from './stores/prefs';
import { useTasksStore } from './stores/tasks';
import { useWorkStore } from './stores/work';

vi.mock('~/api/client', async (importActual) => {
  const actual = await importActual<typeof import('~/api/client')>();
  return {
    ...actual,
    getCampaignWithImageryWindows: vi.fn(),
    getTaskSummary: vi.fn(),
    getTaskDetails: vi.fn(),
    listTaskSets: vi.fn(),
  };
});

import {
  getCampaignWithImageryWindows,
  getTaskDetails,
  getTaskSummary,
  listTaskSets,
} from '~/api/client';
import { loadCampaign } from './loadCampaign';

const source = makeSource({
  id: 1,
  name: 'S1',
  visualizations: [makeViz({ id: 1, name: 'True Color' })],
  collections: [
    makeCollection({ id: 10, name: 'A', slices: [makeSlice({ id: 100, name: 's0' })] }),
  ],
});
const view = makeView({ id: 100, name: 'V1', source_ids: [1] });

const SERVER_TIME = '2024-01-01T00:00:00Z';

const task = (overrides: TaskRowOverrides = {}): TaskRow =>
  makeTaskRow({ id: 1, lon: 0, lat: 0, ...overrides });

const mockTasks = (tasks: TaskRow[]) =>
  vi.mocked(getTaskSummary).mockResolvedValue(apiSuccess(makeTaskSummary(tasks, SERVER_TIME)));

function mockApi({
  tasks = [task()],
  taskSets = [] as TaskSetOut[],
  isPublic = false,
}: {
  tasks?: TaskRow[];
  taskSets?: TaskSetOut[];
  isPublic?: boolean;
} = {}) {
  const campaign = makeCampaign({
    is_public: isPublic,
    imagery_sources: [source],
    imagery_views: [view],
  });
  vi.mocked(getCampaignWithImageryWindows).mockResolvedValue(apiSuccess(campaign));
  mockTasks(tasks);
  vi.mocked(listTaskSets).mockResolvedValue(apiSuccess(taskSets));
  return campaign;
}

beforeEach(() => {
  vi.mocked(getCampaignWithImageryWindows).mockReset();
  vi.mocked(getTaskSummary).mockReset();
  vi.mocked(getTaskDetails).mockReset();
  vi.mocked(getTaskDetails).mockResolvedValue(apiSuccess({ campaign_id: 5, tasks: [] }));
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
    // Polling resumes from the summary's clock, so nothing written since is missed.
    expect(useTasksStore.getState().syncCursor).toBe(SERVER_TIME);
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
      imagery_sources: [source2],
      imagery_views: [view],
    });
    vi.mocked(getCampaignWithImageryWindows).mockResolvedValue(apiSuccess(campaign));
    mockTasks([task()]);
    vi.mocked(listTaskSets).mockResolvedValue(apiSuccess([]));

    usePrefsStore.getState().setPinnedStart(1, 20);

    await loadCampaign(5, { now: 1000, currentUserId: 'u1' });
    expect(useImageryStore.getState().address?.collectionId).toBe(20);
  });

  it('stages a deep-linked annotation id only in explore mode', async () => {
    mockApi({ tasks: [] });
    const result = await loadCampaign(5, {
      now: 1000,
      currentUserId: 'u1',
      annotationId: 42,
    });
    expect(useCampaignStore.getState().workMode).toBe('explore');
    expect(result.annotationId).toBe(42);
  });

  it('does not stage a deep-linked annotation id in tasks mode', async () => {
    mockApi({ tasks: [task()] });
    const result = await loadCampaign(5, {
      now: 1000,
      currentUserId: 'u1',
      workMode: 'tasks',
      annotationId: 42,
    });
    expect(result.annotationId).toBeNull();
  });

  it('opens a campaign with no tasks in explore', async () => {
    mockApi({ tasks: [] });
    await loadCampaign(5, { now: 1000, currentUserId: 'u1' });
    expect(useCampaignStore.getState().workMode).toBe('explore');
    expect(useCampaignStore.getState().isReviewMode).toBe(false);
    expect(useTasksStore.getState().allTasks).toEqual([]);
  });

  it('opens in explore when none of the tasks is the viewer’s to answer', async () => {
    const campaign = mockApi({ tasks: [task()] });
    campaign.settings = {
      ...campaign.settings,
      labelling_policy: {
        ...campaign.settings.labelling_policy,
        unassigned_tasks: { kinds: ['admins'] },
      },
    };
    await loadCampaign(5, { now: 1000, currentUserId: 'u1' });
    expect(useCampaignStore.getState().workMode).toBe('explore');
  });

  it('opens a linked task in tasks mode even when it has no work left', async () => {
    mockApi({ tasks: [task({ task_status: 'done' })] });
    await loadCampaign(5, { now: 1000, currentUserId: 'u1', preferTaskId: 1, isReviewMode: true });
    expect(useCampaignStore.getState().workMode).toBe('tasks');
    expect(useCampaignStore.getState().isReviewMode).toBe(true);
    expect(useTasksStore.getState().visibleTasks.map((t) => t.id)).toContain(1);
  });

  it('respects an explicit initialWorkMode even for a zero-task campaign', async () => {
    mockApi({ tasks: [] });
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
    work.setSelection([11, 12], [1, 2]);

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
