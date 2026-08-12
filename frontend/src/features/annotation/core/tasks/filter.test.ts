import { describe, it, expect } from 'vitest';
import type { AnnotationTaskAssignmentOut, AnnotationTaskOut } from '~/api/client';
import {
  applyTaskFilter,
  computeTaskProgress,
  seedFilter,
  widenFilterForTask,
  type TaskFilter,
} from './filter';
import { UNASSIGNED } from './claims';
import { makeTask, makeTaskSet } from '../catalog/testHelpers';

type TaskStatus = AnnotationTaskOut['task_status'];

// applyTaskFilter takes `now` explicitly - domain logic never reads
// Date.now()/Math.random() - so every call below passes NOW.

const USER = 'user-1';
const OTHER = 'user-2';
const NOW = 1_700_000_000_000;
const fresh = () => new Date(NOW - 60_000).toISOString(); // 1 min ago: an active claim

const task = (
  id: number,
  assignments: AnnotationTaskAssignmentOut[],
  task_status: TaskStatus = 'pending'
) => makeTask({ id, task_status, assignments });

const mineFilter: TaskFilter = {
  assignedTo: [USER],
  statuses: ['pending'],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

describe('applyTaskFilter - claims vs assignments', () => {
  it("counts a hard assignment (claimed_at null) as the user's task", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: null }])];
    expect(applyTaskFilter(tasks, mineFilter, USER, NOW).visibleTasks.map((t) => t.id)).toEqual([
      1,
    ]);
  });

  it("does NOT count a pending soft claim as the user's task (transient hold)", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }])];
    expect(applyTaskFilter(tasks, mineFilter, USER, NOW).visibleTasks).toEqual([]);
  });

  it("still counts a completed claim (the user's finished open-mode work)", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'done', claimed_at: fresh() }], 'done')];
    const doneFilter: TaskFilter = { ...mineFilter, statuses: ['done'] };
    expect(applyTaskFilter(tasks, doneFilter, USER, NOW).visibleTasks.map((t) => t.id)).toEqual([
      1,
    ]);
  });

  it('keeps a task the current user actively claimed in the unassigned pool', () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }])];
    const poolFilter: TaskFilter = { ...mineFilter, assignedTo: [UNASSIGNED] };
    expect(applyTaskFilter(tasks, poolFilter, USER, NOW).visibleTasks.map((t) => t.id)).toEqual([
      1,
    ]);
  });

  it('excludes a task actively claimed by someone else from the pool', () => {
    const tasks = [task(1, [{ user_id: OTHER, status: 'pending', claimed_at: fresh() }])];
    const poolFilter: TaskFilter = { ...mineFilter, assignedTo: [UNASSIGNED] };
    expect(applyTaskFilter(tasks, poolFilter, USER, NOW).visibleTasks).toEqual([]);
  });

  it("without a current user, an active claim is not treated as the pool viewer's own", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }])];
    const poolFilter: TaskFilter = { ...mineFilter, assignedTo: [UNASSIGNED] };
    expect(applyTaskFilter(tasks, poolFilter, null, NOW).visibleTasks).toEqual([]);
  });

  it("the pool shows the user's own claim alongside genuinely free tasks (no mine-pin)", () => {
    const tasks = [
      task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }]),
      task(2, []),
    ];
    expect(applyTaskFilter(tasks, mineFilter, USER, NOW).visibleTasks).toEqual([]);
    const poolFilter: TaskFilter = { ...mineFilter, assignedTo: [UNASSIGNED] };
    expect(applyTaskFilter(tasks, poolFilter, USER, NOW).visibleTasks.map((t) => t.id)).toEqual([
      1, 2,
    ]);
  });
});

describe('applyTaskFilter - task sets', () => {
  const inSet = (id: number, task_set_id: number) => makeTask({ id, task_set_id });

  const allFilter: TaskFilter = {
    assignedTo: [],
    statuses: ['pending'],
    selectedConfidences: [],
    flaggedOnly: false,
    taskSetId: null,
  };

  it('taskSetId null shows tasks from every set', () => {
    const tasks = [inSet(1, 10), inSet(2, 20)];
    expect(applyTaskFilter(tasks, allFilter, null, NOW).visibleTasks.map((t) => t.id)).toEqual([
      1, 2,
    ]);
  });

  it('taskSetId narrows to that set only', () => {
    const tasks = [inSet(1, 10), inSet(2, 20)];
    const filter = { ...allFilter, taskSetId: 20 };
    expect(applyTaskFilter(tasks, filter, null, NOW).visibleTasks.map((t) => t.id)).toEqual([2]);
  });

  it('set filter composes with status filter', () => {
    const tasks = [inSet(1, 10), makeTask({ id: 2, task_set_id: 10, task_status: 'done' })];
    const filter = { ...allFilter, taskSetId: 10 };
    expect(applyTaskFilter(tasks, filter, null, NOW).visibleTasks.map((t) => t.id)).toEqual([1]);
  });
});

describe('applyTaskFilter - preferTaskId', () => {
  const plain = (id: number) => makeTask({ id });

  const allFilter: TaskFilter = {
    assignedTo: [],
    statuses: ['pending'],
    selectedConfidences: [],
    flaggedOnly: false,
    taskSetId: null,
  };

  it('suggests the index of the preferred task when present', () => {
    const tasks = [plain(1), plain(2), plain(3)];
    expect(applyTaskFilter(tasks, allFilter, null, NOW, 3).suggestedIndex).toBe(2);
  });

  it('falls back to 0 when the preferred task is not visible', () => {
    const tasks = [plain(1), plain(2)];
    expect(applyTaskFilter(tasks, allFilter, null, NOW, 999).suggestedIndex).toBe(0);
  });
});

describe('computeTaskProgress', () => {
  const progressTask = (
    task_status: TaskStatus,
    assignments: AnnotationTaskAssignmentOut[] | null
  ) => makeTask({ id: 0, task_status, assignments });

  describe('unscoped (no assignedTo filter)', () => {
    it('counts all tasks and task-level resolution', () => {
      const tasks = [
        progressTask('pending', []),
        progressTask('partial', []),
        progressTask('done', []),
        progressTask('skipped', []),
        progressTask('conflicting', []),
      ];
      expect(computeTaskProgress(tasks, [])).toEqual({ total: 5, completed: 3 });
    });
  });

  describe('scoped to a user', () => {
    it('limits the total to tasks assigned to that user', () => {
      const tasks = [
        progressTask('pending', [{ user_id: USER, status: 'pending' }]),
        progressTask('pending', [{ user_id: OTHER, status: 'pending' }]),
        progressTask('pending', null),
      ];
      expect(computeTaskProgress(tasks, [USER])).toEqual({ total: 1, completed: 0 });
    });

    it('counts a completed review assignment even while the task is partial', () => {
      const tasks = [
        progressTask('partial', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'pending' },
        ]),
      ];
      expect(computeTaskProgress(tasks, [USER])).toEqual({ total: 1, completed: 1 });
    });

    it('counts skipped assignments as handled', () => {
      const tasks = [progressTask('skipped', [{ user_id: USER, status: 'skipped' }])];
      expect(computeTaskProgress(tasks, [USER])).toEqual({ total: 1, completed: 1 });
    });

    it('does not count a task resolved by others while the user is still pending', () => {
      const tasks = [
        progressTask('done', [
          { user_id: USER, status: 'pending' },
          { user_id: OTHER, status: 'done' },
        ]),
      ];
      expect(computeTaskProgress(tasks, [USER])).toEqual({ total: 1, completed: 0 });
    });
  });

  describe('scoped to multiple users', () => {
    it('requires every scoped assignment on the task to be handled', () => {
      const tasks = [
        progressTask('partial', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'pending' },
        ]),
        progressTask('partial', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'skipped' },
        ]),
        progressTask('done', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'done' },
        ]),
      ];
      expect(computeTaskProgress(tasks, [USER, OTHER])).toEqual({ total: 3, completed: 2 });
    });
  });

  describe('UNASSIGNED sentinel', () => {
    it('scopes to assignment-less tasks and falls back to task-level resolution', () => {
      const tasks = [
        progressTask('pending', []),
        progressTask('done', []),
        progressTask('pending', [{ user_id: OTHER, status: 'pending' }]),
      ];
      expect(computeTaskProgress(tasks, [UNASSIGNED])).toEqual({ total: 2, completed: 1 });
    });

    it('composes with user scoping', () => {
      const tasks = [
        progressTask('pending', []),
        progressTask('partial', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'pending' },
        ]),
      ];
      expect(computeTaskProgress(tasks, [UNASSIGNED, USER])).toEqual({ total: 2, completed: 1 });
    });
  });
});

// seedFilter: one test per level of the fallback chain. Each scenario is built
// so the chain lands exactly on the level under test (prior levels are empty
// by construction).
describe('seedFilter - 5-level fallback chain', () => {
  const pendingTask = (
    id: number,
    assignments: AnnotationTaskAssignmentOut[] = [],
    task_set_id = 1
  ) => makeTask({ id, task_set_id, assignments });

  const taskSets = [makeTaskSet({ id: 10, name: 'Set A' })];

  it("level 1: lands on the user's own pending assignments", () => {
    const tasks = [pendingTask(1, [{ user_id: USER, status: 'pending', claimed_at: null }])];
    const filter = seedFilter(tasks, [], USER, NOW);
    expect(filter).toEqual({
      assignedTo: [USER],
      statuses: ['pending'],
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: null,
    });
  });

  it('level 1 (public campaign): lands on the unassigned pool instead of "mine"', () => {
    const tasks = [pendingTask(1)];
    const filter = seedFilter(tasks, [], USER, NOW, { isPublic: true });
    expect(filter.assignedTo).toEqual([UNASSIGNED]);
  });

  it('level 2: user has nothing in the deep-linked set, broadens to the unassigned pool within it', () => {
    const tasks = [
      pendingTask(1, [], 10),
      pendingTask(2, [{ user_id: OTHER, status: 'pending' }], 10),
    ];
    const filter = seedFilter(tasks, taskSets, USER, NOW, { taskSetId: 10 });
    expect(filter).toEqual({
      assignedTo: [UNASSIGNED],
      statuses: ['pending'],
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: 10,
    });
  });

  it('level 3: the deep-linked set has no pending work at all, broadens to every status within it', () => {
    // No pending/unassigned task remains in the set - levels 1 and 2 are both
    // empty, so level 3 (every status, still scoped to the set) picks up the
    // lone 'done' task.
    const doneTasks = [makeTask({ id: 2, task_set_id: 10, task_status: 'done' })];
    const filter = seedFilter(doneTasks, taskSets, USER, NOW, { taskSetId: 10 });
    expect(filter).toEqual({
      assignedTo: [],
      statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: 10,
    });
  });

  it('level 4: no deep-linked set, user has nothing pending, broadens to the unassigned pool overall', () => {
    const tasks = [
      // Hard-assigned to someone else: excluded from "mine" and from the pool.
      pendingTask(1, [{ user_id: OTHER, status: 'pending', claimed_at: null }]),
      // Genuinely free: only this one surfaces once the search broadens to the pool.
      pendingTask(2, []),
    ];
    const filter = seedFilter(tasks, [], USER, NOW);
    expect(filter).toEqual({
      assignedTo: [UNASSIGNED],
      statuses: ['pending'],
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: null,
    });
  });

  it('level 5: even the unassigned pool is empty, falls back to every pending task', () => {
    const tasks = [pendingTask(1, [{ user_id: OTHER, status: 'pending', claimed_at: null }])];
    const filter = seedFilter(tasks, [], USER, NOW);
    expect(filter).toEqual({
      assignedTo: [],
      statuses: ['pending'],
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: null,
    });
  });

  it('an unknown deep-linked task set id is ignored (falls through to the set-less chain)', () => {
    const tasks = [pendingTask(1, [{ user_id: USER, status: 'pending', claimed_at: null }])];
    const filter = seedFilter(tasks, taskSets, USER, NOW, { taskSetId: 999 });
    expect(filter.taskSetId).toBeNull();
    expect(filter.assignedTo).toEqual([USER]);
  });
});

describe('widenFilterForTask', () => {
  const visible = (tasks: AnnotationTaskOut[], filter: TaskFilter) =>
    applyTaskFilter(tasks, filter, USER, NOW).visibleTasks.map((t) => t.id);

  it('leaves a filter that already shows the task untouched', () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: null }])];
    expect(widenFilterForTask(tasks, mineFilter, USER, NOW, 1)).toBe(mineFilter);
  });

  // The annotations page's "View" on a done task, opened in a session seeded
  // on "my pending work": without widening the link lands on task 1 instead.
  it('widens the statuses to reach a done task of the same user', () => {
    const tasks = [
      task(1, [{ user_id: USER, status: 'pending', claimed_at: null }]),
      task(2, [{ user_id: USER, status: 'done', claimed_at: null }], 'done'),
    ];
    const widened = widenFilterForTask(tasks, mineFilter, USER, NOW, 2);
    expect(widened.assignedTo).toEqual([USER]);
    expect(widened.statuses).toEqual(expect.arrayContaining(['pending', 'done']));
    expect(visible(tasks, widened)).toContain(2);
  });

  it('drops the user scoping for a task assigned to somebody else', () => {
    const tasks = [
      task(1, [{ user_id: USER, status: 'pending', claimed_at: null }]),
      task(2, [{ user_id: OTHER, status: 'done', claimed_at: null }], 'done'),
    ];
    const widened = widenFilterForTask(tasks, mineFilter, USER, NOW, 2);
    expect(widened.assignedTo).toEqual([]);
    expect(visible(tasks, widened)).toContain(2);
  });

  it('drops a confidence/flag narrowing when nothing else reaches the task', () => {
    const tasks = [task(1, [{ user_id: USER, status: 'done', claimed_at: null }], 'done')];
    const narrow: TaskFilter = { ...mineFilter, flaggedOnly: true, selectedConfidences: [5] };
    const widened = widenFilterForTask(tasks, narrow, USER, NOW, 1);
    expect(widened.flaggedOnly).toBe(false);
    expect(widened.selectedConfidences).toEqual([]);
    expect(visible(tasks, widened)).toEqual([1]);
  });

  it('returns the filter unchanged for a task that is not in the list at all', () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: null }])];
    expect(widenFilterForTask(tasks, mineFilter, USER, NOW, 404)).toBe(mineFilter);
  });
});
