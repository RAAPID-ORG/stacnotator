import { describe, it, expect } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { applyTaskFilter, computeTaskProgress, UNASSIGNED, type TaskFilter } from './taskFilter';

const USER = 'user-1';
const OTHER = 'user-2';
const NOW = Date.now();
const fresh = () => new Date(NOW - 60_000).toISOString(); // 1 min ago: an active claim

const task = (id: number, assignments: Record<string, unknown>[], task_status = 'pending') =>
  ({ id, task_status, assignments, annotations: [] }) as unknown as AnnotationTaskOut;

const mineFilter: TaskFilter = {
  assignedTo: [USER],
  statuses: ['pending'],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

describe('applyTaskFilter — claims vs assignments', () => {
  it("counts a hard assignment (claimed_at null) as the user's task", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: null }])];
    expect(applyTaskFilter(tasks, mineFilter, USER).visibleTasks.map((t) => t.id)).toEqual([1]);
  });

  it("does NOT count a pending soft claim as the user's task (transient hold)", () => {
    // A leftover pending claim must not pin the user to that task via the "mine" filter.
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }])];
    expect(applyTaskFilter(tasks, mineFilter, USER).visibleTasks).toEqual([]);
  });

  it("still counts a completed claim (the user's finished open-mode work)", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'done', claimed_at: fresh() }], 'done')];
    const doneFilter = { ...mineFilter, statuses: ['done'] } as TaskFilter;
    expect(applyTaskFilter(tasks, doneFilter, USER).visibleTasks.map((t) => t.id)).toEqual([1]);
  });

  it('keeps a task the current user actively claimed in the unassigned pool', () => {
    // Re-entry regression: a task you just claimed must stay visible in the pool so it
    // doesn't drop out of the list until its 30-min TTL expires.
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }])];
    const poolFilter = { ...mineFilter, assignedTo: [UNASSIGNED] } as TaskFilter;
    expect(applyTaskFilter(tasks, poolFilter, USER).visibleTasks.map((t) => t.id)).toEqual([1]);
  });

  it('excludes a task actively claimed by someone else from the pool', () => {
    const tasks = [task(1, [{ user_id: OTHER, status: 'pending', claimed_at: fresh() }])];
    const poolFilter = { ...mineFilter, assignedTo: [UNASSIGNED] } as TaskFilter;
    expect(applyTaskFilter(tasks, poolFilter, USER).visibleTasks).toEqual([]);
  });

  it("without a current user, an active claim is not treated as the pool viewer's own", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }])];
    const poolFilter = { ...mineFilter, assignedTo: [UNASSIGNED] } as TaskFilter;
    expect(applyTaskFilter(tasks, poolFilter, null).visibleTasks).toEqual([]);
  });

  it("the pool shows the user's own claim alongside genuinely free tasks (no mine-pin)", () => {
    const tasks = [
      task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }]),
      task(2, []),
    ];
    // The "mine" filter still yields nothing, so the user is never pinned onto the claim.
    expect(applyTaskFilter(tasks, mineFilter, USER).visibleTasks).toEqual([]);
    // The pool surfaces both the free task and the user's own held task.
    const poolFilter = { ...mineFilter, assignedTo: [UNASSIGNED] } as TaskFilter;
    expect(applyTaskFilter(tasks, poolFilter, USER).visibleTasks.map((t) => t.id)).toEqual([1, 2]);
  });
});

describe('applyTaskFilter — task sets', () => {
  const inSet = (id: number, task_set_id: number) =>
    ({
      id,
      task_set_id,
      task_status: 'pending',
      assignments: [],
      annotations: [],
    }) as unknown as AnnotationTaskOut;

  const allFilter: TaskFilter = {
    assignedTo: [],
    statuses: ['pending'],
    selectedConfidences: [],
    flaggedOnly: false,
    taskSetId: null,
  };

  it('taskSetId null shows tasks from every set', () => {
    const tasks = [inSet(1, 10), inSet(2, 20)];
    expect(applyTaskFilter(tasks, allFilter, null).visibleTasks.map((t) => t.id)).toEqual([1, 2]);
  });

  it('taskSetId narrows to that set only', () => {
    const tasks = [inSet(1, 10), inSet(2, 20)];
    const filter = { ...allFilter, taskSetId: 20 };
    expect(applyTaskFilter(tasks, filter, null).visibleTasks.map((t) => t.id)).toEqual([2]);
  });

  it('set filter composes with status filter', () => {
    const tasks = [
      inSet(1, 10),
      { ...inSet(2, 10), task_status: 'done' } as unknown as AnnotationTaskOut,
    ];
    const filter = { ...allFilter, taskSetId: 10 };
    expect(applyTaskFilter(tasks, filter, null).visibleTasks.map((t) => t.id)).toEqual([1]);
  });
});

describe('computeTaskProgress', () => {
  const progressTask = (
    task_status: string,
    assignments: Array<{ user_id: string; status: string }> | null
  ) => ({ id: 0, task_status, assignments, annotations: [] }) as unknown as AnnotationTaskOut;

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
      // User finished their part; co-assignee has not acted, so the
      // task-level status lags at 'partial'. The user's counter must move.
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
      // Mirrors the pending-status filter: the task still shows up in the
      // user's pending list, so it cannot be counted as completed.
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
