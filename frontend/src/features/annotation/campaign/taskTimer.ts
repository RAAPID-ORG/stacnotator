/** How long after the last input the clock keeps running. Annotators routinely
 *  sit still while comparing two dates or reading a timeseries, so stopping the
 *  moment the mouse stops would under-report exactly the hard tasks we want to
 *  find. Beyond this the user is assumed to have walked away. */
export const IDLE_GRACE_MS = 30_000;

/** Ceiling on one visit to a task, so a window left open overnight contributes
 *  a plausible number rather than dominating the campaign's statistics. */
export const VISIT_CAP_MS = 10 * 60 * 1000;

export interface TaskTimer {
  /** Called on real user input: pointer, key, wheel. */
  noteActivity(now: number): void;
  /** Document visibility changed. Hidden stops the clock with no grace. */
  setVisible(visible: boolean, now: number): void;
  /** Move to a different task, banking whatever the current one has earned. */
  focus(taskId: number | null, now: number): void;
  /** Accumulated active milliseconds for a task, including time earned so far
   *  on the currently focused one. */
  read(taskId: number, now: number): number;
  /** Drop a task's count, so a later edit of it is measured on its own. Kept
   *  separate from `read` so a failed submit can be retried without the time
   *  having already been thrown away. */
  forget(taskId: number, now: number): void;
}

/** Accumulates active time per task.
 *
 *  Time is credited retroactively rather than by ticking: at each settle point
 *  we grant the span from the last settle up to `lastActivity + IDLE_GRACE_MS`,
 *  capped at now. An idle gap therefore contributes exactly the grace window
 *  and nothing more, however long it lasts and however often we sample - so the
 *  result does not depend on a timer interval firing.
 *
 *  Deliberately in-memory only: a reload starts a task's count fresh rather
 *  than resuming a stale one from storage.
 */
export function createTaskTimer(now: number): TaskTimer {
  const banked = new Map<number, number>();
  let current: number | null = null;
  let visible = true;
  let lastActivity = now;
  let settledAt = now;

  const earnedSince = (at: number): number => {
    if (!visible) return 0;
    const until = Math.min(at, lastActivity + IDLE_GRACE_MS);
    return Math.max(0, until - settledAt);
  };

  const settle = (at: number): void => {
    if (current !== null) {
      const total = (banked.get(current) ?? 0) + earnedSince(at);
      banked.set(current, Math.min(total, VISIT_CAP_MS));
    }
    settledAt = Math.max(settledAt, at);
  };

  return {
    noteActivity(at) {
      settle(at);
      lastActivity = at;
    },
    setVisible(next, at) {
      settle(at);
      visible = next;
      // Coming back from a hidden tab is not itself activity, but the grace
      // window must not be spent on time the user could not have been working.
      if (next) lastActivity = at;
    },
    focus(taskId, at) {
      settle(at);
      current = taskId;
    },
    read(taskId, at) {
      const pending = current === taskId ? earnedSince(at) : 0;
      return Math.min((banked.get(taskId) ?? 0) + pending, VISIT_CAP_MS);
    },
    forget(taskId, at) {
      settle(at);
      banked.delete(taskId);
    },
  };
}
