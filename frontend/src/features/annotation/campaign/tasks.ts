import type {
  AnnotationFromTaskOut,
  AnnotationTaskAssignmentOut,
  AnnotationTaskOut,
  TaskSetOut,
} from '~/api/client';
import type { TaskStatus } from './annotation';

// ---------------------------------------------------------------------------
// Soft claims
// ---------------------------------------------------------------------------

/** Usable inside TaskFilter.assignedTo to mean "tasks with no assignments". */
export const UNASSIGNED = '__unassigned__';

/** Usable inside TaskFilter.selectedLabelIds to mean "annotations that carry
 *  no label", which is what a skip leaves behind. Label ids are positive. */
export const UNLABELLED = -1;

/** Mirrors the backend's CLAIM_TTL_MINUTES. */
export const CLAIM_TTL_MS = 30 * 60 * 1000;

export interface Claim {
  userId: string;
  displayName: string | null;
  heldForMs: number;
}

/** Who is working on this task right now, if anyone. A claim is a lease and
 *  expires, which is why the caller passes the time. */
export function getActiveClaim(task: AnnotationTaskOut, now: number): Claim | null {
  if (!task.claimed_by_user_id || !task.claimed_at) return null;
  const heldForMs = now - new Date(task.claimed_at).getTime();
  if (heldForMs > CLAIM_TTL_MS) return null;
  return {
    userId: task.claimed_by_user_id,
    displayName: task.claimed_by_display_name ?? null,
    heldForMs,
  };
}

/** Free work: nobody assigned to it, nobody has worked it, nobody holds it. */
export function isClaimable(task: AnnotationTaskOut, now: number): boolean {
  if ((task.annotations || []).length > 0) return false;
  if ((task.assignments || []).length > 0) return false;
  return getActiveClaim(task, now) === null;
}

export function claimedByLabel(
  task: AnnotationTaskOut,
  currentUserId: string | null | undefined,
  now: number
): string | null {
  const claim = getActiveClaim(task, now);
  if (!claim) return null;
  if (claim.userId === currentUserId) return 'Claimed by you';
  return `${claim.displayName || 'Someone else'} is working on this`;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface TaskFilter {
  assignedTo: string[];
  statuses: TaskStatus[];
  selectedLabelIds: number[];
  selectedConfidences: number[];
  flaggedOnly: boolean;
  taskSetId: number | null;
}

export const ALL_TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'partial',
  'done',
  'skipped',
  'conflicting',
];

const RESOLVED: TaskStatus[] = ['done', 'skipped', 'conflicting'];

type ProgressInput = Pick<AnnotationTaskOut, 'task_status' | 'assignments'>;

const isResolved = (task: ProgressInput): boolean =>
  RESOLVED.includes((task.task_status ?? 'pending') as TaskStatus);

/**
 * Progress within `assignedTo`'s scope (everything when empty). Scoped to
 * users it follows their own assignment status rather than the task's, which
 * lags at 'partial' until co-assignees act and would otherwise hold back the
 * progress of the users actually being counted.
 */
export function computeTaskProgress(
  allTasks: ProgressInput[],
  assignedTo: string[]
): { total: number; completed: number } {
  if (assignedTo.length === 0) {
    return { total: allTasks.length, completed: allTasks.filter(isResolved).length };
  }

  const wantUnassigned = assignedTo.includes(UNASSIGNED);
  let total = 0;
  let completed = 0;
  for (const task of allTasks) {
    const assignments = task.assignments || [];
    const scoped = assignments.filter((a) => assignedTo.includes(a.user_id));
    if (scoped.length > 0) {
      total += 1;
      if (scoped.every((a) => a.status !== 'pending')) completed += 1;
    } else if (wantUnassigned && assignments.length === 0) {
      total += 1;
      if (isResolved(task)) completed += 1;
    }
  }
  return { total, completed };
}

/** Held by this user via their own live claim, so a task they just claimed
 *  does not drop out of their unassigned pool on re-entry. */
const isHeldBy = (task: AnnotationTaskOut, userId: string | null | undefined, now: number) =>
  userId != null && getActiveClaim(task, now)?.userId === userId;

/** Whether "next" means "ask the server for a free task".
 *
 *  Only the unassigned pool works that way. A filter naming real users is a
 *  view over their assigned work, where nothing is being raced for; and no
 *  other filter dimension can coexist with a claimable task, so a pool with
 *  one of those set renders empty and never gets here. */
export const usesClaimPool = (filter: TaskFilter): boolean =>
  filter.assignedTo.length === 1 && filter.assignedTo[0] === UNASSIGNED;

export interface FilteredTasks {
  visibleTasks: AnnotationTaskOut[];
  suggestedIndex: number;
}

export function applyTaskFilter(
  allTasks: AnnotationTaskOut[],
  filter: TaskFilter,
  currentUserId: string | null | undefined,
  now: number,
  preferTaskId?: number
): FilteredTasks {
  const filterByUser = filter.assignedTo.length > 0;
  const wantUnassigned = filter.assignedTo.includes(UNASSIGNED);
  const selectedUserIds = filter.assignedTo.filter((id) => id !== UNASSIGNED);

  const visibleTasks = allTasks.filter((task) => {
    if (filter.taskSetId !== null && task.task_set_id !== filter.taskSetId) return false;

    const assignments = task.assignments || [];
    const annotations = task.annotations || [];

    if (filterByUser) {
      const matchesUser =
        selectedUserIds.length > 0 &&
        assignments.some(
          (a) => selectedUserIds.includes(a.user_id) && filter.statuses.includes(a.status)
        );
      const matchesUnassigned =
        wantUnassigned &&
        (isClaimable(task, now) || isHeldBy(task, currentUserId, now)) &&
        filter.statuses.includes(task.task_status ?? 'pending');
      if (!matchesUser && !matchesUnassigned) return false;
    } else if (!filter.statuses.includes(task.task_status ?? 'pending')) {
      return false;
    }

    if (filter.selectedLabelIds.length > 0) {
      const matchesLabel = annotations.some((a) =>
        filter.selectedLabelIds.includes(a.label_id ?? UNLABELLED)
      );
      if (!matchesLabel) return false;
    }

    if (filter.selectedConfidences.length > 0) {
      const confidences = annotations.map((a) => a.confidence ?? 0);
      if (confidences.length === 0) confidences.push(0);
      if (!confidences.some((c) => filter.selectedConfidences.includes(c))) return false;
    }

    if (filter.flaggedOnly && !annotations.some((a) => a.flagged_for_review)) return false;

    return true;
  });

  const preferred =
    preferTaskId != null ? visibleTasks.findIndex((t) => t.id === preferTaskId) : -1;
  return { visibleTasks, suggestedIndex: preferred >= 0 ? preferred : 0 };
}

/**
 * Widens `filter` as little as it takes for `taskId` to show - a deep link
 * into a done task while the session seeded "my pending work". Returned
 * unchanged when no widening reaches it, so a link to another campaign's task
 * cannot blank the filter.
 */
export function widenFilterForTask(
  allTasks: AnnotationTaskOut[],
  filter: TaskFilter,
  currentUserId: string | null | undefined,
  now: number,
  taskId: number
): TaskFilter {
  const shows = (candidate: TaskFilter) =>
    applyTaskFilter(allTasks, candidate, currentUserId, now).visibleTasks.some(
      (t) => t.id === taskId
    );
  if (shows(filter)) return filter;

  const statuses = [...ALL_TASK_STATUSES];
  const candidates: TaskFilter[] = [
    { ...filter, statuses },
    { ...filter, statuses, assignedTo: [], taskSetId: null },
    {
      assignedTo: [],
      statuses,
      selectedLabelIds: [],
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: null,
    },
  ];
  return candidates.find(shows) ?? filter;
}

/**
 * The filter a session lands on. Levels are tried in order and the first with
 * a non-empty result wins: the user's own pending work (the unassigned pool
 * for a public campaign or an unknown user) scoped to a deep-linked task set,
 * then the unassigned pool in that set, then every status in that set, then
 * the unassigned pool unscoped, then everything pending. With no tasks at all
 * every level is empty and the last candidate tried is returned.
 */
export function seedFilter(
  allTasks: AnnotationTaskOut[],
  taskSets: TaskSetOut[],
  currentUserId: string | null | undefined,
  now: number,
  deepLink: { taskSetId?: number; isPublic?: boolean } = {}
): TaskFilter {
  const linked =
    deepLink.taskSetId !== undefined && taskSets.some((s) => s.id === deepLink.taskSetId)
      ? deepLink.taskSetId
      : null;
  const setId = linked !== null && allTasks.some((t) => t.task_set_id === linked) ? linked : null;
  const showAll = deepLink.isPublic === true;

  const pending = (assignedTo: string[], taskSetId: number | null = null): TaskFilter => ({
    assignedTo,
    statuses: ['pending'],
    selectedLabelIds: [],
    selectedConfidences: [],
    flaggedOnly: false,
    taskSetId,
  });
  const nonEmpty = (candidate: TaskFilter) =>
    applyTaskFilter(allTasks, candidate, currentUserId, now).visibleTasks.length > 0;

  let filter = pending(showAll || !currentUserId ? [UNASSIGNED] : [currentUserId], setId);
  if (nonEmpty(filter)) return filter;

  if (setId !== null && currentUserId && !showAll) {
    filter = pending([UNASSIGNED], setId);
    if (nonEmpty(filter)) return filter;
  }
  if (setId !== null) {
    filter = {
      assignedTo: [],
      statuses: [...ALL_TASK_STATUSES],
      selectedLabelIds: [],
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: setId,
    };
    if (nonEmpty(filter)) return filter;
  }
  if (currentUserId && !showAll) {
    filter = pending([UNASSIGNED]);
    if (nonEmpty(filter)) return filter;
  }
  return allTasks.length > 0 ? pending([]) : filter;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export function nextIndex(visible: AnnotationTaskOut[], current: number): number {
  if (visible.length === 0) return current;
  return current >= visible.length - 1 ? 0 : current + 1;
}

export function prevIndex(visible: AnnotationTaskOut[], current: number): number {
  if (visible.length === 0) return current;
  return current === 0 ? visible.length - 1 : current - 1;
}

// ---------------------------------------------------------------------------
// Review list
// ---------------------------------------------------------------------------

/** One row of the task's "all annotations" list: somebody's submission, or an
 *  assignee who has not labelled yet. Display names and label lookups stay in
 *  the UI, which holds the current user and the label catalog. */
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
  const isConflicting = taskStatus === 'conflicting';

  return [...new Set([...assnByUser.keys(), ...annByUser.keys()])].map((userId): ReviewRow => {
    const annotation = annByUser.get(userId);
    const assignment = assnByUser.get(userId) ?? null;
    // Every id came from one of the two maps, so no annotation means an
    // assignment put it there.
    if (!annotation) return { kind: 'pending', userId, assignment: assignment! };

    return {
      kind: 'annotation',
      userId,
      annotation,
      assignment,
      isConflict: isConflicting && !annotation.is_authoritative,
      isAuthoritative: annotation.is_authoritative ?? false,
      isExtra: annotation.counts_toward_completion === false,
      // Read off the annotation, not an assignment: somebody who took the
      // task out of the free pool and skipped it has no assignment row.
      isSkipped: annotation.label_id == null,
    };
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = 'csv' | 'geojson';

export function exportRows(campaignId: number, mergeOnAgreement: boolean) {
  return {
    path: { campaign_id: campaignId },
    ...(mergeOnAgreement ? { query: { merge_on_agreement: true } } : {}),
    parseAs: 'blob' as const,
  };
}

/** The server's Content-Disposition filename when it sends one, else a
 *  slugified fallback. */
export function resolveExportFilename(
  campaignName: string,
  format: ExportFormat,
  contentDisposition: string | null
): string {
  const ext = format === 'geojson' ? 'geojson' : 'csv';
  const fallback = `${campaignName.replace(/\s+/g, '_')}_annotations.${ext}`;
  const match = contentDisposition?.match(/filename="?(.+)"?/i);
  return match ? match[1] : fallback;
}

export function parseExportErrorDetail(body: string): string | null {
  try {
    return (JSON.parse(body) as { detail?: string }).detail ?? null;
  } catch {
    return null;
  }
}
