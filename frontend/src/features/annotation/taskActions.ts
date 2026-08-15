import {
  completeAnnotationTask,
  deleteAnnotation,
  validateAnnotationSubmission,
  type AnnotationTaskAssignmentOut,
  type AnnotationTaskOut,
  type AnnotationTaskSubmitResponse,
} from '~/api/client';
import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import {
  isAudienceMember,
  maySubmitTask,
  validateForm,
  type FormValues,
  type PolicyContext,
  type SubmitReadiness,
  type TaskStatus,
} from './campaign/annotation';
import { listNotes, type SliceComment } from './campaign/sliceComments';
import { campaignState, formFields, useCampaignStore } from './stores/campaign';
import { currentTask, useTasksStore } from './stores/tasks';
import { usePrefsStore } from './stores/prefs';
import { forgetTaskActiveMs, readTaskActiveMs } from './taskTiming';
import { useWorkStore } from './stores/work';

export const DEFAULT_CONFIDENCE = 5;

// ---------------------------------------------------------------------------
// Labelling policy
// ---------------------------------------------------------------------------

export interface TaskPolicy {
  mayLabel: boolean;
  countsTowardCompletion: boolean;
  isAssignedToTask: boolean;
}

/**
 * An unassigned task is gated by `unassigned_tasks` on both axes, so the two
 * only diverge on an assigned one - a label that counts is a strict subset of
 * one that may be given at all. Fails open before anything is loaded; the
 * server stays the authority regardless.
 */
export function taskLabellingPolicy(task: AnnotationTaskOut | null): TaskPolicy {
  const { campaign, currentUserId } = useCampaignStore.getState();
  const isAssignedToTask = task?.assignments?.some((a) => a.user_id === currentUserId) ?? false;
  const policy = campaign?.settings.labelling_policy;
  if (!campaign || !task || !policy) {
    return { mayLabel: true, countsTowardCompletion: true, isAssignedToTask };
  }

  const assigned = (task.assignments?.length ?? 0) > 0;
  const ctx: PolicyContext = {
    userId: currentUserId,
    isAdmin: campaign.viewer_is_admin ?? false,
    isAuthoritative: campaign.viewer_is_authoritative_reviewer ?? false,
    isMember: campaign.viewer_is_member ?? false,
    isAssigned: isAssignedToTask,
  };
  return {
    mayLabel: isAudienceMember(assigned ? policy.assigned_tasks : policy.unassigned_tasks, ctx),
    countsTowardCompletion: isAudienceMember(
      assigned ? policy.complete_assigned : policy.unassigned_tasks,
      ctx
    ),
    isAssignedToTask,
  };
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

type SubmitOutcome =
  | { kind: 'blocked'; missing: string[] }
  | { kind: 'needsConfirm' }
  | { kind: 'submitted'; task: AnnotationTaskOut }
  | { kind: 'removed'; task: AnnotationTaskOut }
  | { kind: 'error'; message: string };

const TASK_STATUSES = ['pending', 'partial', 'done', 'skipped', 'conflicting'] as const;
const ASSIGNMENT_STATUSES = ['pending', 'done', 'skipped'] as const;

/** The submit and delete responses type these as plain strings. */
const toTaskStatus = (value: string | undefined): TaskStatus | undefined =>
  TASK_STATUSES.find((status) => status === value);

const toAssignmentStatus = (
  value: string | undefined
): AnnotationTaskAssignmentOut['status'] | undefined =>
  ASSIGNMENT_STATUSES.find((status) => status === value);

function withAssignmentStatus(
  task: AnnotationTaskOut,
  currentUserId: string,
  status: string | undefined
): AnnotationTaskAssignmentOut[] {
  return (task.assignments || []).map((a) =>
    a.user_id === currentUserId ? { ...a, status: toAssignmentStatus(status) ?? 'pending' } : a
  );
}

export interface SubmitParams {
  task: AnnotationTaskOut;
  currentUserId: string;
  labelId: number | null;
  comment: string;
  confidence: number;
  isAuthoritative?: boolean;
  flagged: boolean;
  flagComment: string;
  formValues: FormValues;
  sliceComments: SliceComment[];
  knnValidationEnabled: boolean;
  /** Set on a resubmit after "submit anyway", so a mismatch shown once does
   *  not ask again. */
  confirmMismatch?: boolean;
}

export async function submitCurrent(params: SubmitParams): Promise<SubmitOutcome> {
  const campaignId = campaignState().campaign.id;
  const { task, currentUserId, labelId, comment } = params;

  // Guarded here rather than only in the button's disabled state: the Enter
  // key calls this directly and would otherwise reach the backend's 422.
  // Skips have no label and are exempt, matching the backend.
  if (labelId !== null) {
    const { ok, missing } = validateForm(formFields(), params.formValues);
    if (!ok) return { kind: 'blocked', missing };
  }

  const mine = task.annotations.find((a) => a.created_by_user_id === currentUserId);

  // "Take my label off this task": nothing chosen, one already there, and no
  // comment being added.
  if (labelId === null && mine?.label_id != null && !comment) {
    try {
      const { data } = await deleteAnnotation({
        path: { campaign_id: campaignId, annotation_id: mine.id },
      });
      return {
        kind: 'removed',
        task: {
          ...task,
          annotations: task.annotations.filter((a) => a.id !== mine.id),
          assignments: withAssignmentStatus(task, currentUserId, data?.assignment_status),
          task_status: toTaskStatus(data?.task_status) ?? 'pending',
        },
      };
    } catch (error) {
      return { kind: 'error', message: extractErrorMessage(error) };
    }
  }

  if (params.knnValidationEnabled && labelId !== null && !params.confirmMismatch) {
    try {
      const validation = await validateAnnotationSubmission({
        path: { campaign_id: campaignId, annotation_task_id: task.id },
        query: { label_id: labelId },
      });
      if (validation.data?.status === 'mismatch') return { kind: 'needsConfirm' };
    } catch {
      // Validation unavailable - do not block the submission on it.
    }
  }

  try {
    const response = await completeAnnotationTask({
      path: { campaign_id: campaignId, annotation_task_id: task.id },
      body: {
        label_id: labelId,
        comment: comment || null,
        confidence: params.confidence,
        is_authoritative: params.isAuthoritative ?? null,
        flagged_for_review: params.flagged,
        flag_comment: params.flagged ? params.flagComment || null : null,
        form_values: Object.keys(params.formValues).length ? params.formValues : null,
        slice_comments: params.sliceComments,
        active_ms: readTaskActiveMs(task.id),
      },
    });
    // Only once the backend has it: a failed submit keeps the time for the retry.
    forgetTaskActiveMs(task.id);
    const result: AnnotationTaskSubmitResponse | undefined = response.data;
    const added = result?.annotation ?? null;
    return {
      kind: 'submitted',
      task: {
        ...task,
        annotations: added
          ? [...task.annotations.filter((a) => a.created_by_user_id !== currentUserId), added]
          : task.annotations.filter((a) => a.created_by_user_id !== currentUserId),
        assignments: withAssignmentStatus(task, currentUserId, result?.assignment_status),
        task_status: toTaskStatus(result?.task_status) ?? task.task_status,
      },
    };
  } catch (error) {
    return { kind: 'error', message: extractErrorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// The actions the buttons and the keys share
// ---------------------------------------------------------------------------

const alert = (message: string, kind: 'error' | 'success') =>
  useGlobalLayoutStore.getState().showAlert(message, kind);

/** The Submit button's own enabled state, read off the live stores so the
 *  keyboard path can never diverge from it. */
export function currentSubmitReadiness(): SubmitReadiness {
  const task = currentTask();
  const { currentUserId } = useCampaignStore.getState();
  const mine = task?.annotations.find((a) => a.created_by_user_id === currentUserId);
  return {
    selectedLabelId: useWorkStore.getState().selectedLabelId,
    hasExistingLabel: mine?.label_id != null,
    mayLabel: taskLabellingPolicy(task).mayLabel,
    isSubmitting: useTasksStore.getState().isSubmitting,
  };
}

async function run(options: {
  labelId: number | null;
  isAuthoritative?: boolean;
  confirmMismatch?: boolean;
}): Promise<SubmitOutcome> {
  const { catalog } = campaignState();
  const task = currentTask();
  const { currentUserId } = useCampaignStore.getState();
  if (!task || !currentUserId) return { kind: 'error', message: 'No current task to submit' };

  const work = useWorkStore.getState();
  const outcome = await submitCurrent({
    task,
    currentUserId,
    labelId: options.labelId,
    comment: work.comment,
    confidence: work.confidence ?? DEFAULT_CONFIDENCE,
    isAuthoritative: options.isAuthoritative,
    flagged: work.flagged,
    flagComment: work.flagComment,
    formValues: work.formValues,
    sliceComments: listNotes(work.sliceNotes),
    knnValidationEnabled: useTasksStore.getState().knnValidationEnabled,
    confirmMismatch: options.confirmMismatch,
  });

  const tasks = useTasksStore.getState();
  if (outcome.kind === 'blocked') alert(`Missing required: ${outcome.missing.join(', ')}`, 'error');
  else if (outcome.kind === 'error') alert(outcome.message, 'error');
  else if (outcome.kind === 'submitted') {
    tasks.replaceTask(outcome.task, catalog);
    tasks.next(catalog);
  } else if (outcome.kind === 'removed') {
    tasks.replaceTask(outcome.task, catalog);
  }
  return outcome;
}

const MISMATCH_CONFIRM = {
  title: 'Label Mismatch Detected',
  description:
    'This label does not match what the nearest-neighbour embedding model would predict. Are you sure you want to submit this label?',
  confirmText: 'Submit Anyway',
  cancelText: 'Go Back',
  isDangerous: true,
};

/** Runs `body` only while no submit is in flight - the same guard the buttons
 *  enforce through `isSubmitting`. */
async function guarded(body: () => Promise<void>): Promise<void> {
  const tasks = useTasksStore.getState();
  if (tasks.isSubmitting) return;
  tasks.setSubmitting(true);
  try {
    await body();
  } finally {
    useTasksStore.getState().setSubmitting(false);
  }
}

/** Submit with the KNN mismatch confirm loop folded in: a 'needsConfirm' asks
 *  and, on confirmation, resubmits with the check skipped. */
async function submitWith(isAuthoritative?: boolean): Promise<void> {
  const readiness = currentSubmitReadiness();
  if (!readiness.mayLabel) {
    alert('You are not allowed to label this task in this campaign.', 'error');
    return;
  }
  if (!maySubmitTask(readiness)) return;

  if (isAuthoritative) {
    const confirmed = await useGlobalLayoutStore.getState().showConfirmDialog({
      title: 'Submit as authoritative?',
      description:
        'Your label will be recorded as the canonical answer for this task and mark it completed, overriding any other annotators and skipping consensus from assignees.',
      confirmText: 'Submit Authoritative',
      cancelText: 'Cancel',
      isDangerous: true,
    });
    if (!confirmed) return;
  }

  await guarded(async () => {
    const labelId = useWorkStore.getState().selectedLabelId;
    const first = await run({ labelId, isAuthoritative });
    if (first.kind !== 'needsConfirm') return;
    if (await useGlobalLayoutStore.getState().showConfirmDialog(MISMATCH_CONFIRM)) {
      await run({ labelId, isAuthoritative, confirmMismatch: true });
    }
  });
}

export const submitAnnotation = () => submitWith();

/** Records the canonical answer, overriding other annotators and completing
 *  the task regardless of consensus. */
export const submitAuthoritative = () => submitWith(true);

/** Submits with no label, clearing any label of ours. Only an assignee can
 *  skip: it stores a null-label annotation, which only means something
 *  against an assignment. */
export async function skipCurrent(): Promise<void> {
  if (!taskLabellingPolicy(currentTask()).isAssignedToTask) {
    alert('You are not assigned to this task.', 'error');
    return;
  }
  if (!usePrefsStore.getState().skipConfirmDisabled) {
    const confirmed = await useGlobalLayoutStore.getState().showConfirmDialog({
      title: 'Skip annotation?',
      description: 'You can come back to it later.',
      confirmText: 'Skip',
      cancelText: 'Cancel',
      showDontAskAgain: true,
      onDontAskAgain: () => usePrefsStore.getState().setSkipConfirmDisabled(true),
    });
    if (!confirmed) return;
  }
  await guarded(async () => {
    await run({ labelId: null });
  });
}
