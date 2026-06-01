export type AssignmentMode = 'distribute-evenly' | 'fixed-count';

export interface TaskLike {
  id: number;
}

/**
 * Distributes all tasks evenly across users using a shuffled round-robin.
 * Each user receives either floor(N/M) or ceil(N/M) tasks.
 * Shuffling ensures users don't always receive the same geographic slice.
 */
export function distributeEvenly(
  taskIds: number[],
  userIds: string[]
): { [taskId: number]: string[] } {
  if (userIds.length === 0 || taskIds.length === 0) return {};

  const shuffled = shuffleArray(taskIds);
  const assignments: { [taskId: number]: string[] } = {};

  shuffled.forEach((taskId, index) => {
    assignments[taskId] = [userIds[index % userIds.length]];
  });

  return assignments;
}

/**
 * Assigns a fixed number of tasks to each user from a shuffled task pool.
 * Users are processed in order; tasks are not double-assigned.
 */
export function assignFixedCount(
  taskIds: number[],
  userCounts: { userId: string; count: number }[]
): { [taskId: number]: string[] } {
  if (userCounts.length === 0 || taskIds.length === 0) return {};

  const shuffled = shuffleArray(taskIds);
  const assignments: { [taskId: number]: string[] } = {};
  let cursor = 0;

  for (const { userId, count } of userCounts) {
    for (let i = 0; i < count && cursor < shuffled.length; i++) {
      const taskId = shuffled[cursor++];
      assignments[taskId] = [userId];
    }
  }

  return assignments;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Returns per-user task counts from an assignments map. */
export function countPerUser(assignments: { [taskId: number]: string[] }): Map<string, number> {
  const counts = new Map<string, number>();
  for (const users of Object.values(assignments)) {
    for (const u of users) {
      counts.set(u, (counts.get(u) ?? 0) + 1);
    }
  }
  return counts;
}
