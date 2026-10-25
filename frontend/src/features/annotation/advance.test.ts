import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '~/api/client';
import { apiSuccess, makeCampaign, makeTask, makeTaskAnnotation } from './testing/fixtures';
import { seedCampaign } from './testing/seed';
import { UNASSIGNED, type TaskFilter } from './campaign/tasks';
import { useTasksStore } from './stores/tasks';
import { useWorkStore } from './stores/work';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { advance, goToNextTask, submitAnnotation } from './taskActions';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, claimNextTask: vi.fn(), annotateTask: vi.fn() };
});

const POOL: TaskFilter = {
  assignedTo: [UNASSIGNED],
  statuses: ['pending'],
  selectedLabelIds: [],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};
const MINE: TaskFilter = { ...POOL, assignedTo: ['u1'] };

const free = (id: number) => makeTask({ id, annotation_number: id });

const alerts: string[] = [];
beforeEach(() => {
  vi.mocked(api.claimNextTask).mockReset();
  vi.mocked(api.annotateTask).mockReset();
  alerts.length = 0;
  useLayoutStore.setState({ showAlert: (message) => alerts.push(message) });
});

const currentId = () => {
  const { visibleTasks, currentIndex } = useTasksStore.getState();
  return visibleTasks[currentIndex]?.id;
};

describe('advance', () => {
  it('asks the server for the next free task when working the unassigned pool', async () => {
    seedCampaign(makeCampaign(), {
      currentUserId: 'u1',
      tasks: [free(1), free(2)],
      filter: POOL,
    });
    const claimed = { ...free(9), claimed_by_user_id: 'u1', claimed_at: new Date().toISOString() };
    vi.mocked(api.claimNextTask).mockResolvedValue(apiSuccess({ task: claimed }));

    await advance();

    // The server's pick wins over the next entry in this session's stale list.
    expect(currentId()).toBe(9);
    const call = vi.mocked(api.claimNextTask).mock.calls[0][0];
    expect(call.query?.after_annotation_number).toBe(1);
  });

  it('passes the task set through, so the pool stays scoped to it', async () => {
    seedCampaign(makeCampaign(), {
      currentUserId: 'u1',
      tasks: [free(1)],
      filter: { ...POOL, taskSetId: 4 },
    });
    vi.mocked(api.claimNextTask).mockResolvedValue(apiSuccess({ task: null }));

    await advance();

    expect(vi.mocked(api.claimNextTask).mock.calls[0][0].query?.task_set_id).toBe(4);
  });

  it('says so and stays put once the pool is drained', async () => {
    seedCampaign(makeCampaign(), {
      currentUserId: 'u1',
      tasks: [free(1)],
      filter: POOL,
    });
    vi.mocked(api.claimNextTask).mockResolvedValue(apiSuccess({ task: null }));

    await advance();

    expect(currentId()).toBe(1);
    expect(alerts).toContainEqual(expect.stringContaining('No unassigned tasks left'));
  });

  it('shows the all-done state once the task just finished was the last', async () => {
    const catalog = seedCampaign(makeCampaign(), {
      currentUserId: 'u1',
      tasks: [free(1)],
      filter: POOL,
    });
    useTasksStore.getState().replaceTask(
      {
        ...free(1),
        task_status: 'done',
        annotations: [makeTaskAnnotation({ created_by_user_id: 'u1' })],
      },
      catalog
    );
    vi.mocked(api.claimNextTask).mockResolvedValue(apiSuccess({ task: null }));

    await advance();

    expect(useTasksStore.getState().visibleTasks).toEqual([]);
  });

  it('steps locally for a filter that is a fixed list, without a round trip', async () => {
    const assigned = (id: number) =>
      makeTask({ id, annotation_number: id, assignments: [{ user_id: 'u1', status: 'pending' }] });
    seedCampaign(makeCampaign(), {
      currentUserId: 'u1',
      tasks: [assigned(1), assigned(2)],
      filter: MINE,
    });

    await advance();

    expect(currentId()).toBe(2);
    expect(api.claimNextTask).not.toHaveBeenCalled();
  });

  it('keeps the user where they are when the request fails', async () => {
    seedCampaign(makeCampaign(), {
      currentUserId: 'u1',
      tasks: [free(1)],
      filter: POOL,
    });
    vi.mocked(api.claimNextTask).mockRejectedValue(new Error('network down'));

    await advance();

    expect(currentId()).toBe(1);
    expect(alerts).toContainEqual(expect.stringContaining('network down'));
  });
});

describe('a step while a save is out', () => {
  const assigned = (id: number) =>
    makeTask({ id, annotation_number: id, assignments: [{ user_id: 'u1', status: 'pending' }] });

  it('a slow save does not pull the user off a task they moved to meanwhile', async () => {
    const catalog = seedCampaign(makeCampaign(), {
      currentUserId: 'u1',
      tasks: [assigned(1), assigned(2), assigned(3)],
      filter: MINE,
    });
    let land!: () => void;
    const landed = new Promise<void>((resolve) => (land = resolve));
    vi.mocked(api.annotateTask).mockImplementation(async () => {
      await landed;
      return apiSuccess({
        annotation: makeTaskAnnotation({ id: 50, label_id: 10 }),
        assignment_status: 'done',
        task_status: 'done',
      });
    });
    useWorkStore.getState().setSelectedLabelId(10);

    const saving = submitAnnotation();
    // The filter panel stays usable during a save, and can change the task.
    useTasksStore.getState().goToAnnotationNumber(3, catalog);
    land();
    await saving;

    expect(currentId()).toBe(3);
  });

  it('quick presses of Next take one step per round trip instead of racing', async () => {
    seedCampaign(makeCampaign(), {
      currentUserId: 'u1',
      tasks: [free(1), free(2), free(3)],
      filter: POOL,
    });
    const claimed = { ...free(2), claimed_by_user_id: 'u1', claimed_at: new Date().toISOString() };
    vi.mocked(api.claimNextTask).mockResolvedValue(apiSuccess({ task: claimed }));

    await Promise.all([goToNextTask(), goToNextTask(), goToNextTask()]);

    expect(api.claimNextTask).toHaveBeenCalledTimes(1);
    expect(currentId()).toBe(2);
  });
});
