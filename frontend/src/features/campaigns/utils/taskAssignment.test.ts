import { describe, it, expect } from 'vitest';
import { distributeEvenly, assignFixedCount, countPerUser } from './taskAssignment';

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const users = (n: number) => Array.from({ length: n }, (_, i) => `user-${i + 1}`);

describe('distributeEvenly', () => {
  it('assigns every task exactly once', () => {
    const taskIds = ids(12);
    const userIds = users(3);
    const result = distributeEvenly(taskIds, userIds);

    expect(
      Object.keys(result)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual(taskIds);
    for (const assigned of Object.values(result)) {
      expect(assigned).toHaveLength(1);
    }
  });

  it('distributes tasks equally across users (floor/ceil)', () => {
    const taskIds = ids(10);
    const userIds = users(3);
    const result = distributeEvenly(taskIds, userIds);
    const counts = countPerUser(result);

    const values = [...counts.values()];
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(max - min).toBeLessThanOrEqual(1);
    expect(values.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('assigns all tasks to a single user when only one is selected', () => {
    const taskIds = ids(5);
    const result = distributeEvenly(taskIds, ['user-1']);
    const counts = countPerUser(result);
    expect(counts.get('user-1')).toBe(5);
  });

  it('handles more users than tasks - extra users get no tasks', () => {
    const taskIds = ids(2);
    const userIds = users(5);
    const result = distributeEvenly(taskIds, userIds);
    expect(Object.keys(result)).toHaveLength(2);
    const counts = countPerUser(result);
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
  });

  it('returns empty when no tasks', () => {
    expect(distributeEvenly([], users(3))).toEqual({});
  });

  it('returns empty when no users', () => {
    expect(distributeEvenly(ids(5), [])).toEqual({});
  });

  it('each user receives an approximately equal share across many runs', () => {
    const taskIds = ids(99);
    const userIds = users(3);
    for (let run = 0; run < 20; run++) {
      const result = distributeEvenly(taskIds, userIds);
      const counts = countPerUser(result);
      const values = [...counts.values()];
      const min = Math.min(...values);
      const max = Math.max(...values);
      expect(max - min).toBeLessThanOrEqual(1);
    }
  });
});

describe('assignFixedCount', () => {
  it('assigns exactly the requested number of tasks per user', () => {
    const taskIds = ids(20);
    const userCounts = [
      { userId: 'user-1', count: 5 },
      { userId: 'user-2', count: 8 },
    ];
    const result = assignFixedCount(taskIds, userCounts);
    const counts = countPerUser(result);
    expect(counts.get('user-1')).toBe(5);
    expect(counts.get('user-2')).toBe(8);
    expect(Object.keys(result)).toHaveLength(13);
  });

  it('does not assign more tasks than available', () => {
    const taskIds = ids(3);
    const userCounts = [
      { userId: 'user-1', count: 2 },
      { userId: 'user-2', count: 10 },
    ];
    const result = assignFixedCount(taskIds, userCounts);
    expect(Object.keys(result)).toHaveLength(3);
  });

  it('assigns no task twice', () => {
    const taskIds = ids(10);
    const userCounts = [
      { userId: 'user-1', count: 6 },
      { userId: 'user-2', count: 6 },
    ];
    const result = assignFixedCount(taskIds, userCounts);
    const assignedIds = Object.keys(result).map(Number);
    expect(new Set(assignedIds).size).toBe(assignedIds.length);
    expect(assignedIds.length).toBe(10);
  });

  it('returns empty when no tasks', () => {
    expect(assignFixedCount([], [{ userId: 'user-1', count: 5 }])).toEqual({});
  });

  it('returns empty when no users', () => {
    expect(assignFixedCount(ids(5), [])).toEqual({});
  });
});
