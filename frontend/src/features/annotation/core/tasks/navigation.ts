import type { AnnotationTaskOut } from '~/api/client';

/** Advance within the visible task list, wrapping past the end. No-op
 *  (returns `current` unchanged) when nothing is visible. */
export function nextIndex(visible: AnnotationTaskOut[], current: number): number {
  if (visible.length === 0) return current;
  return current >= visible.length - 1 ? 0 : current + 1;
}

/** Step back within the visible task list, wrapping before the start. No-op
 *  when nothing is visible. */
export function prevIndex(visible: AnnotationTaskOut[], current: number): number {
  if (visible.length === 0) return current;
  return current === 0 ? visible.length - 1 : current - 1;
}

/** Index of the task with the given annotation_number, or -1 when it isn't
 *  in the visible list (deep link to a task the current filter hides). */
export function goTo(visible: AnnotationTaskOut[], annotationNumber: number): number {
  return visible.findIndex((t) => t.annotation_number === annotationNumber);
}
