import { describe, expect, it } from 'vitest';
import { createTaskTimer, IDLE_GRACE_MS, VISIT_CAP_MS, type TaskTimer } from './taskTimer';

const SECOND = 1000;

/** What a submit does: report the time, then drop it. */
const submit = (t: TaskTimer, taskId: number, at: number): number => {
  const ms = t.read(taskId, at);
  t.forget(taskId, at);
  return ms;
};

describe('createTaskTimer', () => {
  it('counts the span between activity on the focused task', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    t.noteActivity(5 * SECOND);

    expect(submit(t, 1, 5 * SECOND)).toBe(5 * SECOND);
  });

  it('keeps counting while the annotator sits still inside the grace window', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);

    expect(t.read(1, IDLE_GRACE_MS - SECOND)).toBe(IDLE_GRACE_MS - SECOND);
  });

  it('credits an idle gap with exactly the grace window, however long the gap', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    // Away for an hour, then back.
    t.noteActivity(60 * 60 * SECOND);

    expect(submit(t, 1, 60 * 60 * SECOND)).toBe(IDLE_GRACE_MS);
  });

  it('does not depend on how often it is sampled', () => {
    const sparse = createTaskTimer(0);
    sparse.focus(1, 0);
    sparse.noteActivity(10 * 60 * SECOND);

    const frequent = createTaskTimer(0);
    frequent.focus(1, 0);
    for (let at = SECOND; at <= 10 * 60 * SECOND; at += SECOND) frequent.read(1, at);
    frequent.noteActivity(10 * 60 * SECOND);

    expect(submit(frequent, 1, 10 * 60 * SECOND)).toBe(submit(sparse, 1, 10 * 60 * SECOND));
  });

  it('stops immediately when the document is hidden, with no grace', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    t.noteActivity(2 * SECOND);
    t.setVisible(false, 3 * SECOND);

    expect(t.read(1, 10 * 60 * SECOND)).toBe(3 * SECOND);
  });

  it('resumes on becoming visible again', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    t.setVisible(false, 2 * SECOND);
    t.setVisible(true, 60 * SECOND);
    t.noteActivity(65 * SECOND);

    expect(submit(t, 1, 65 * SECOND)).toBe(7 * SECOND);
  });

  it('banks time per task and does not leak between them', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    t.noteActivity(4 * SECOND);
    t.focus(2, 4 * SECOND);
    t.noteActivity(10 * SECOND);

    expect(submit(t, 1, 10 * SECOND)).toBe(4 * SECOND);
    expect(submit(t, 2, 10 * SECOND)).toBe(6 * SECOND);
  });

  it('resumes a task revisited within the same page session', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    t.noteActivity(4 * SECOND);
    t.focus(2, 4 * SECOND);
    t.noteActivity(6 * SECOND);
    t.focus(1, 6 * SECOND);
    t.noteActivity(9 * SECOND);

    expect(submit(t, 1, 9 * SECOND)).toBe(7 * SECOND);
  });

  it('starts an edit of an already-submitted task from zero', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    t.noteActivity(5 * SECOND);
    submit(t, 1, 5 * SECOND);
    t.noteActivity(8 * SECOND);

    expect(submit(t, 1, 8 * SECOND)).toBe(3 * SECOND);
  });

  it('keeps the time when a submit is only read, so a failed one can retry', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    t.noteActivity(5 * SECOND);

    expect(t.read(1, 5 * SECOND)).toBe(5 * SECOND);
    // Request failed - nothing was forgotten, and the retry still has it.
    t.noteActivity(7 * SECOND);
    expect(submit(t, 1, 7 * SECOND)).toBe(7 * SECOND);
  });

  it('caps a single visit so a forgotten window cannot dominate the stats', () => {
    const t = createTaskTimer(0);
    t.focus(1, 0);
    for (let at = SECOND; at <= 30 * 60 * SECOND; at += SECOND) t.noteActivity(at);

    expect(submit(t, 1, 30 * 60 * SECOND)).toBe(VISIT_CAP_MS);
  });

  it('earns nothing while no task is focused', () => {
    const t = createTaskTimer(0);
    t.noteActivity(5 * SECOND);
    t.focus(1, 5 * SECOND);

    expect(t.read(1, 5 * SECOND)).toBe(0);
  });
});
