import { describe, it, expect } from 'vitest';
import { computeTaskProgress } from './taskFilter';

const task = (
  task_status: string,
  assignments: Array<{ user_id: string; status: string }> | null
) => ({ task_status, assignments });

const USER = 'user-a';
const OTHER = 'user-b';

describe('computeTaskProgress', () => {
  describe('unscoped (no assignedTo filter)', () => {
    it('counts all tasks and task-level resolution', () => {
      const tasks = [
        task('pending', []),
        task('partial', []),
        task('done', []),
        task('skipped', []),
        task('conflicting', []),
      ];
      expect(computeTaskProgress(tasks, [])).toEqual({ total: 5, completed: 3 });
    });
  });

  describe('scoped to a user', () => {
    it('limits the total to tasks assigned to that user', () => {
      const tasks = [
        task('pending', [{ user_id: USER, status: 'pending' }]),
        task('pending', [{ user_id: OTHER, status: 'pending' }]),
        task('pending', null),
      ];
      expect(computeTaskProgress(tasks, [USER])).toEqual({ total: 1, completed: 0 });
    });

    it('counts a completed review assignment even while the task is partial', () => {
      // User finished their part; co-assignee has not acted, so the
      // task-level status lags at 'partial'. The user's counter must move.
      const tasks = [
        task('partial', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'pending' },
        ]),
      ];
      expect(computeTaskProgress(tasks, [USER])).toEqual({ total: 1, completed: 1 });
    });

    it('counts skipped assignments as handled', () => {
      const tasks = [task('skipped', [{ user_id: USER, status: 'skipped' }])];
      expect(computeTaskProgress(tasks, [USER])).toEqual({ total: 1, completed: 1 });
    });

    it('does not count a task resolved by others while the user is still pending', () => {
      // Mirrors the pending-status filter: the task still shows up in the
      // user's pending list, so it cannot be counted as completed.
      const tasks = [
        task('done', [
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
        task('partial', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'pending' },
        ]),
        task('partial', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'skipped' },
        ]),
        task('done', [
          { user_id: USER, status: 'done' },
          { user_id: OTHER, status: 'done' },
        ]),
      ];
      expect(computeTaskProgress(tasks, [USER, OTHER])).toEqual({ total: 3, completed: 2 });
    });
  });
});
