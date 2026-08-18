import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '~/api/client';
import { apiSuccess, makeCampaign, makeTask } from './testing/fixtures';
import { seedCampaign } from './testing/seed';
import { UNASSIGNED, type TaskFilter } from './campaign/tasks';
import { useTasksStore } from './stores/tasks';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { advance } from './taskActions';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, claimNextAnnotationTask: vi.fn() };
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
  vi.mocked(api.claimNextAnnotationTask).mockReset();
  alerts.length = 0;
  useLayoutStore.setState({ showAlert: (message) => alerts.push(message) });
});

const currentId = () => {
  const { visibleTasks, currentIndex } = useTasksStore.getState();
  return visibleTasks[currentIndex]?.id;
};

describe('advance', () => {
  it('asks the server for the next free task when working the unassigned pool', async () => {
    seedCampaign(makeCampaign({ mode: 'tasks' }), {
      currentUserId: 'u1',
      tasks: [free(1), free(2)],
      filter: POOL,
    });
    const claimed = { ...free(9), claimed_by_user_id: 'u1', claimed_at: new Date().toISOString() };
    vi.mocked(api.claimNextAnnotationTask).mockResolvedValue(apiSuccess({ task: claimed }));

    await advance();

    // The server's pick wins over the next entry in this session's stale list.
    expect(currentId()).toBe(9);
    const call = vi.mocked(api.claimNextAnnotationTask).mock.calls[0][0];
    expect(call.query?.after_annotation_number).toBe(1);
  });

  it('passes the task set through, so the pool stays scoped to it', async () => {
    seedCampaign(makeCampaign({ mode: 'tasks' }), {
      currentUserId: 'u1',
      tasks: [free(1)],
      filter: { ...POOL, taskSetId: 4 },
    });
    vi.mocked(api.claimNextAnnotationTask).mockResolvedValue(apiSuccess({ task: null }));

    await advance();

    expect(vi.mocked(api.claimNextAnnotationTask).mock.calls[0][0].query?.task_set_id).toBe(4);
  });

  it('says so and stays put once the pool is drained', async () => {
    seedCampaign(makeCampaign({ mode: 'tasks' }), {
      currentUserId: 'u1',
      tasks: [free(1)],
      filter: POOL,
    });
    vi.mocked(api.claimNextAnnotationTask).mockResolvedValue(apiSuccess({ task: null }));

    await advance();

    expect(currentId()).toBe(1);
    expect(alerts).toContainEqual(expect.stringContaining('No unassigned tasks left'));
  });

  it('steps locally for a filter that is a fixed list, without a round trip', async () => {
    const assigned = (id: number) =>
      makeTask({ id, annotation_number: id, assignments: [{ user_id: 'u1', status: 'pending' }] });
    seedCampaign(makeCampaign({ mode: 'tasks' }), {
      currentUserId: 'u1',
      tasks: [assigned(1), assigned(2)],
      filter: MINE,
    });

    await advance();

    expect(currentId()).toBe(2);
    expect(api.claimNextAnnotationTask).not.toHaveBeenCalled();
  });

  it('keeps the user where they are when the request fails', async () => {
    seedCampaign(makeCampaign({ mode: 'tasks' }), {
      currentUserId: 'u1',
      tasks: [free(1)],
      filter: POOL,
    });
    vi.mocked(api.claimNextAnnotationTask).mockRejectedValue(new Error('network down'));

    await advance();

    expect(currentId()).toBe(1);
    expect(alerts).toContainEqual(expect.stringContaining('network down'));
  });
});
