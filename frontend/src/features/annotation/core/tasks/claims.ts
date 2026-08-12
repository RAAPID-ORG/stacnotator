import type { AnnotationTaskAssignmentOut, AnnotationTaskOut } from '~/api/client';

// Sentinel value usable inside TaskFilter.assignedTo to match tasks that have
// no assignments. Lets the assignee filter express "unassigned" explicitly.
export const UNASSIGNED = '__unassigned__';

// Must mirror backend CLAIM_TTL_MINUTES; a claim older than this is stale/available.
export const CLAIM_TTL_MS = 30 * 60 * 1000;

const isStaleClaim = (a: AnnotationTaskAssignmentOut, now: number): boolean =>
  a.claimed_at != null &&
  a.status === 'pending' &&
  now - new Date(a.claimed_at).getTime() > CLAIM_TTL_MS;

// A task can be soft-claimed if no one has worked it and every assignment is a stale
// soft claim. Truly-unassigned tasks satisfy `[].every(...) === true`.
export const isClaimable = (task: AnnotationTaskOut, now: number): boolean => {
  if ((task.annotations || []).length > 0) return false;
  return (task.assignments || []).every((a) => isStaleClaim(a, now));
};

// The active soft claim currently holding a task (for the "Claimed by" badge), or null.
export const getActiveClaim = (
  task: AnnotationTaskOut,
  now: number
): AnnotationTaskAssignmentOut | null =>
  (task.assignments || []).find(
    (a) =>
      a.claimed_at != null &&
      a.status === 'pending' &&
      now - new Date(a.claimed_at).getTime() <= CLAIM_TTL_MS
  ) ?? null;

// User-facing "Claimed by ..." badge text (Canvas.tsx:453-478's derivation),
// or null when nobody currently holds the task.
export const claimedByLabel = (
  task: AnnotationTaskOut,
  currentUserId: string | null | undefined,
  now: number
): string | null => {
  const claim = getActiveClaim(task, now);
  if (!claim) return null;
  if (claim.user_id === currentUserId) return 'Claimed by you';
  return `Claimed by ${claim.user_display_name || claim.user_email || 'another user'}`;
};
