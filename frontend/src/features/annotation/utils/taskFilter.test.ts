import { describe, it, expect } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { applyTaskFilter, UNASSIGNED, type TaskFilter } from './taskFilter';

const USER = 'user-1';
const NOW = Date.now();
const fresh = () => new Date(NOW - 60_000).toISOString(); // 1 min ago: an active claim

const task = (id: number, assignments: Record<string, unknown>[], task_status = 'pending') =>
  ({ id, task_status, assignments, annotations: [] }) as unknown as AnnotationTaskOut;

const mineFilter: TaskFilter = {
  assignedTo: [USER],
  statuses: ['pending'],
  selectedConfidences: [],
  flaggedOnly: false,
};

describe('applyTaskFilter — claims vs assignments', () => {
  it("counts a hard assignment (claimed_at null) as the user's task", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: null }])];
    expect(applyTaskFilter(tasks, mineFilter).visibleTasks.map((t) => t.id)).toEqual([1]);
  });

  it("does NOT count a pending soft claim as the user's task (transient hold)", () => {
    // The bug: a leftover pending claim pinned the user to that task on re-entry.
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }])];
    expect(applyTaskFilter(tasks, mineFilter).visibleTasks).toEqual([]);
  });

  it("still counts a completed claim (the user's finished open-mode work)", () => {
    const tasks = [task(1, [{ user_id: USER, status: 'done', claimed_at: fresh() }], 'done')];
    const doneFilter = { ...mineFilter, statuses: ['done'] } as TaskFilter;
    expect(applyTaskFilter(tasks, doneFilter).visibleTasks.map((t) => t.id)).toEqual([1]);
  });

  it('excludes a task actively claimed by the user from the unassigned pool', () => {
    const tasks = [task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }])];
    const poolFilter = { ...mineFilter, assignedTo: [UNASSIGNED] } as TaskFilter;
    expect(applyTaskFilter(tasks, poolFilter).visibleTasks).toEqual([]);
  });

  it('a user with only a pending claim falls through to the free pool (no pin)', () => {
    // claimed task + a genuinely free task: the "mine" filter yields nothing, so navigation
    // falls back to the unassigned pool, which surfaces the free task (not the claimed one).
    const tasks = [
      task(1, [{ user_id: USER, status: 'pending', claimed_at: fresh() }]),
      task(2, []),
    ];
    expect(applyTaskFilter(tasks, mineFilter).visibleTasks).toEqual([]);
    const poolFilter = { ...mineFilter, assignedTo: [UNASSIGNED] } as TaskFilter;
    expect(applyTaskFilter(tasks, poolFilter).visibleTasks.map((t) => t.id)).toEqual([2]);
  });
});
