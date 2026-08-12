import type { AnnotationFromTaskOut, AnnotationTaskAssignmentOut } from '~/api/client';
import type { TaskStatus } from '~/features/annotation/core/apiTypes';

/** One row in the task's "all annotations" review list: either someone's
 *  submitted annotation (with derived conflict/authoritative/extra/skipped
 *  flags) or an assignee who hasn't labeled yet. Display-name resolution and
 *  label-name lookup stay in the UI layer, which has the current-user id and
 *  label catalog. */
export type ReviewRow =
  | {
      kind: 'annotation';
      userId: string;
      annotation: AnnotationFromTaskOut;
      assignment: AnnotationTaskAssignmentOut | null;
      isConflict: boolean;
      isAuthoritative: boolean;
      isExtra: boolean;
      isSkipped: boolean;
    }
  | { kind: 'pending'; userId: string; assignment: AnnotationTaskAssignmentOut };

export function reviewRows(
  annotations: AnnotationFromTaskOut[],
  assignments: AnnotationTaskAssignmentOut[],
  taskStatus: TaskStatus | undefined
): ReviewRow[] {
  const annByUser = new Map(annotations.map((a) => [a.created_by_user_id, a]));
  const assnByUser = new Map(assignments.map((a) => [a.user_id, a]));
  const userIds = new Set([...assnByUser.keys(), ...annByUser.keys()]);
  const isConflicting = taskStatus === 'conflicting';

  return [...userIds].map((userId): ReviewRow => {
    const annotation = annByUser.get(userId);
    const assignment = assnByUser.get(userId) ?? null;

    if (!annotation) {
      // Every userId came from either map; no annotation means an assignment
      // put it in the set, so it is present here.
      return { kind: 'pending', userId, assignment: assignment! };
    }

    return {
      kind: 'annotation',
      userId,
      annotation,
      assignment,
      isConflict: isConflicting && !annotation.is_authoritative,
      isAuthoritative: annotation.is_authoritative ?? false,
      isExtra: annotation.counts_toward_completion === false,
      isSkipped: assignment?.status === 'skipped',
    };
  });
}
