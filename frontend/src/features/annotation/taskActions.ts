import {
  claimNextTask,
  annotateTask,
  deleteAnnotation,
  validateTaskLabel,
  type AnnotationTaskAssignmentOut,
  type AnnotationTaskOut,
  type AnnotationTaskSubmitResponse,
} from '~/api/client';
import i18n from '~/shared/i18n';
import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { extractErrorMessage, handleError } from '~/shared/utils/errorHandler';
import type { TaskOutcome } from '~/shared/utils/taskStatus';
import { isAudienceMember, type PolicyContext } from '~/features/campaigns/utils/labellingPolicy';
import {
  maySubmitTask,
  validateForm,
  type FormValues,
  type SubmitReadiness,
} from './campaign/annotation';
import { listNotes, type SliceComment } from './campaign/sliceComments';
import { usesClaimPool } from './campaign/tasks';
import { campaignState, formFields, useCampaignStore } from './stores/campaign';
import { currentTask, useTasksStore } from './stores/tasks';
import { usePrefsStore } from './stores/prefs';
import { forgetTaskActiveMs, readTaskActiveMs } from './taskTiming';
import { useWorkStore } from './stores/work';

const t = i18n.getFixedT(null, ['annotation', 'common']);

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
  const isAssignedToTask = task?.assignments.some((a) => a.user_id === currentUserId) ?? false;
  const policy = campaign?.settings.labelling_policy;
  if (!campaign || !task || !policy) {
    return { mayLabel: true, countsTowardCompletion: true, isAssignedToTask };
  }

  const assigned = task.assignments.length > 0;
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

function withAssignmentStatus(
  task: AnnotationTaskOut,
  currentUserId: string,
  status: AnnotationTaskAssignmentOut['status']
): AnnotationTaskAssignmentOut[] {
  return task.assignments.map((a) => (a.user_id === currentUserId ? { ...a, status } : a));
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
  /** Set by the Skip action. Both it and Remove Label submit without a label,
   *  and they mean opposite things - skipping records that you looked and
   *  moved on, removing takes your work off the task - so the intent is passed
   *  rather than guessed from the absent label. */
  isSkip?: boolean;
  /** Required for draw tasks; a classify submission's label already says it. */
  outcome?: TaskOutcome;
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
  if (!params.isSkip && labelId === null && mine?.label_id != null && !comment) {
    try {
      const { data } = await deleteAnnotation({
        path: { campaign_id: campaignId, annotation_id: mine.id },
      });
      if (!data) return { kind: 'error', message: t('taskActions.submitFailed') };
      return {
        kind: 'removed',
        task: {
          ...task,
          annotations: task.annotations.filter((a) => a.id !== mine.id),
          assignments: withAssignmentStatus(task, currentUserId, data.assignment_status),
          task_status: data.task_status,
        },
      };
    } catch (error) {
      return { kind: 'error', message: extractErrorMessage(error) };
    }
  }

  if (params.knnValidationEnabled && labelId !== null && !params.confirmMismatch) {
    try {
      const validation = await validateTaskLabel({
        path: { campaign_id: campaignId, task_id: task.id },
        query: { label_id: labelId },
      });
      if (validation.data?.status === 'mismatch') return { kind: 'needsConfirm' };
    } catch {
      // Validation unavailable - do not block the submission on it.
    }
  }

  try {
    const response = await annotateTask({
      path: { campaign_id: campaignId, task_id: task.id },
      body: {
        label_id: labelId,
        comment: comment || null,
        confidence: params.confidence,
        is_authoritative: params.isAuthoritative ?? null,
        flagged_for_review: params.flagged,
        flag_comment: params.flagged ? params.flagComment || null : null,
        form_values: Object.keys(params.formValues).length ? params.formValues : null,
        slice_comments: params.sliceComments,
        outcome: params.outcome ?? null,
        active_ms: readTaskActiveMs(task.id),
      },
    });
    const result: AnnotationTaskSubmitResponse | undefined = response.data;
    if (!result) return { kind: 'error', message: t('taskActions.submitFailed') };

    // Only once the backend has it: a failed submit keeps the time for the retry.
    forgetTaskActiveMs(task.id);
    return {
      kind: 'submitted',
      task: {
        ...task,
        annotations: [
          ...task.annotations.filter((a) => a.created_by_user_id !== currentUserId),
          result.annotation,
        ],
        assignments: withAssignmentStatus(task, currentUserId, result.assignment_status),
        task_status: result.task_status,
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
function currentSubmitReadiness(): SubmitReadiness {
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
  isSkip?: boolean;
  outcome?: TaskOutcome;
}): Promise<SubmitOutcome> {
  const { catalog } = campaignState();
  const task = currentTask();
  const { currentUserId } = useCampaignStore.getState();
  if (!task || !currentUserId) return { kind: 'error', message: t('taskActions.noTask') };

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
    isSkip: options.isSkip,
    outcome: options.outcome,
  });

  const tasks = useTasksStore.getState();
  if (outcome.kind === 'blocked')
    alert(t('missingRequired', { fields: outcome.missing.join(', ') }), 'error');
  else if (outcome.kind === 'error') alert(outcome.message, 'error');
  else if (outcome.kind === 'submitted') {
    tasks.replaceTask(outcome.task, catalog);
    await advance();
  } else if (outcome.kind === 'removed') {
    tasks.replaceTask(outcome.task, catalog);
  }
  return outcome;
}

/**
 * Move to the next task to work on.
 *
 * In the unassigned pool the server picks it: only it knows what is still
 * free, and it claims the task in the same transaction, so annotators working
 * the same campaign are handed different tasks instead of each walking the
 * list and colliding on every one somebody already took. Every other filter is
 * a fixed list of tasks, where stepping locally is both correct and instant.
 */
export async function advance(): Promise<void> {
  const { catalog } = campaignState();
  const tasks = useTasksStore.getState();
  if (!usesClaimPool(tasks.filter)) {
    tasks.next(catalog);
    return;
  }

  const current = currentTask();
  try {
    const { data } = await claimNextTask({
      path: { campaign_id: campaignState().campaign.id },
      query: {
        task_set_id: tasks.filter.taskSetId,
        after_annotation_number: current?.annotation_number,
      },
    });
    if (data?.task) useTasksStore.getState().adoptTask(data.task, catalog);
    else alert(t('taskActions.noneLeft'), 'success');
  } catch (error) {
    handleError(error, t('taskActions.nextFailed'));
  }
}

const mismatchConfirm = () => ({
  title: t('taskActions.mismatch.title'),
  description: t('taskActions.mismatch.description'),
  confirmText: t('taskActions.mismatch.confirm'),
  cancelText: t('taskActions.mismatch.cancel'),
  isDangerous: true,
});

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
    alert(t('taskActions.notAllowed'), 'error');
    return;
  }
  if (!maySubmitTask(readiness)) return;

  if (isAuthoritative) {
    const confirmed = await useGlobalLayoutStore.getState().showConfirmDialog({
      title: t('taskActions.authoritative.title'),
      description: t('taskActions.authoritative.description'),
      confirmText: t('taskActions.authoritative.confirm'),
      cancelText: t('common:actions.cancel'),
      isDangerous: true,
    });
    if (!confirmed) return;
  }

  await guarded(async () => {
    const labelId = useWorkStore.getState().selectedLabelId;
    const first = await run({ labelId, isAuthoritative });
    if (first.kind !== 'needsConfirm') return;
    if (await useGlobalLayoutStore.getState().showConfirmDialog(mismatchConfirm())) {
      await run({ labelId, isAuthoritative, confirmMismatch: true });
    }
  });
}

export const submitAnnotation = () => submitWith();

/** Records the canonical answer, overriding other annotators and completing
 *  the task regardless of consensus. */
export const submitAuthoritative = () => submitWith(true);

/** Submits with no label, clearing any label of ours. Stores a label-less
 *  annotation, which is the record that this user looked and moved on. */
export async function skipCurrent(): Promise<void> {
  if (!taskLabellingPolicy(currentTask()).mayLabel) {
    alert(t('taskActions.notAllowed'), 'error');
    return;
  }
  if (!usePrefsStore.getState().skipConfirmDisabled) {
    const confirmed = await useGlobalLayoutStore.getState().showConfirmDialog({
      title: t('taskActions.skip.title'),
      description: t('taskActions.skip.description'),
      confirmText: t('taskActions.skip.confirm'),
      cancelText: t('common:actions.cancel'),
      showDontAskAgain: true,
      onDontAskAgain: () => usePrefsStore.getState().setSkipConfirmDisabled(true),
    });
    if (!confirmed) return;
  }
  await guarded(async () => {
    await run({ labelId: null, isSkip: true, outcome: 'skipped' });
  });
}

/** Finishes a draw task: `drawn` once this user's shapes for it are on the
 *  map (the server checks there is at least one), `none_found` when there was
 *  nothing to draw. */
export async function finishDrawTask(outcome: 'drawn' | 'none_found'): Promise<void> {
  const { draft } = useWorkStore.getState();
  if ((draft.phase === 'draft' || draft.phase === 'committing') && draft.savedId === null) {
    alert(t('taskActions.finishDraftFirst'), 'error');
    return;
  }
  await guarded(async () => {
    await run({ labelId: null, outcome });
  });
}
