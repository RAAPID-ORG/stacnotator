import { createTaskTimer } from './campaign/taskTimer';

/** The page's single task stopwatch.
 *
 *  Module state rather than a store: nothing renders from it, so keeping it out
 *  of Zustand avoids re-rendering the workspace on every mouse move. Replaced
 *  wholesale on campaign load, and gone on reload - a revisited task starts
 *  counting again from zero rather than resuming a stale total.
 */
let timer = createTaskTimer(Date.now());
let lastNoted = 0;

/** Pointer moves arrive by the hundred per second and the grace window is
 *  measured in tens of seconds, so noting one per second loses nothing. */
const NOTE_INTERVAL_MS = 1000;

export const resetTaskTiming = (): void => {
  timer = createTaskTimer(Date.now());
  lastNoted = 0;
};

export const noteTaskActivity = (): void => {
  const now = Date.now();
  if (now - lastNoted < NOTE_INTERVAL_MS) return;
  lastNoted = now;
  timer.noteActivity(now);
};

export const setTaskTimingVisible = (visible: boolean): void =>
  timer.setVisible(visible, Date.now());

export const focusTimedTask = (taskId: number | null): void => timer.focus(taskId, Date.now());

/** Milliseconds to report for a task. Reading does not clear: a submit that
 *  fails must leave the annotator's time intact for the retry. */
export const readTaskActiveMs = (taskId: number): number => timer.read(taskId, Date.now());

/** Called once the time has been accepted by the backend, so a later edit of
 *  the same task is measured on its own. */
export const forgetTaskActiveMs = (taskId: number): void => timer.forget(taskId, Date.now());
