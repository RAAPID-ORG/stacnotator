import {
  completeAnnotationTask,
  deleteAnnotation,
  validateAnnotationSubmission,
  type AnnotationTaskAssignmentOut,
  type AnnotationTaskOut,
  type AnnotationTaskSubmitResponse,
} from '~/api/client';
import type { FormField, FormValues, TaskStatus } from '~/features/annotation/core/apiTypes';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { validateForm } from '~/features/annotation/core/annotation';

export interface SubmitParams {
  campaignId: number;
  task: AnnotationTaskOut;
  currentUserId: string;
  fields: FormField[];
  labelId: number | null;
  comment: string;
  confidence: number;
  isAuthoritative?: boolean;
  flagged: boolean;
  flagComment: string;
  formValues: FormValues;
  knnValidationEnabled: boolean;
  /** Set on a resubmit after the caller's "submit anyway" confirmation, so a
   *  mismatch already shown once doesn't ask again. */
  confirmMismatch?: boolean;
}

export type SubmitOutcome =
  | { kind: 'blocked'; missing: string[] }
  | { kind: 'needsConfirm' }
  | { kind: 'submitted'; task: AnnotationTaskOut }
  | { kind: 'removed'; task: AnnotationTaskOut }
  | { kind: 'error'; message: string };

type AssignmentStatus = AnnotationTaskAssignmentOut['status'];

const TASK_STATUSES = ['pending', 'partial', 'done', 'skipped', 'conflicting'] as const;
const ASSIGNMENT_STATUSES = ['pending', 'done', 'skipped'] as const;

/** The submit/delete responses type these as plain strings; keep only the
 *  values the task model actually has. */
function toTaskStatus(value: string | undefined): TaskStatus | undefined {
  return TASK_STATUSES.find((status) => status === value);
}

function toAssignmentStatus(value: string | undefined): AssignmentStatus | undefined {
  return ASSIGNMENT_STATUSES.find((status) => status === value);
}

function applySubmission(
  task: AnnotationTaskOut,
  currentUserId: string,
  result?: AnnotationTaskSubmitResponse
): AnnotationTaskOut {
  const newAnnotation = result?.annotation ?? null;
  const annotations = newAnnotation
    ? [...task.annotations.filter((a) => a.created_by_user_id !== currentUserId), newAnnotation]
    : task.annotations.filter((a) => a.created_by_user_id !== currentUserId);
  return {
    ...task,
    annotations,
    assignments: (task.assignments || []).map((a) =>
      a.user_id === currentUserId
        ? { ...a, status: toAssignmentStatus(result?.assignment_status) ?? 'pending' }
        : a
    ),
    task_status: toTaskStatus(result?.task_status) ?? task.task_status,
  };
}

function applyRemoval(
  task: AnnotationTaskOut,
  removedAnnotationId: number,
  currentUserId: string,
  result?: AnnotationTaskSubmitResponse | null
): AnnotationTaskOut {
  return {
    ...task,
    annotations: task.annotations.filter((a) => a.id !== removedAnnotationId),
    assignments: (task.assignments || []).map((a) =>
      a.user_id === currentUserId
        ? { ...a, status: toAssignmentStatus(result?.assignment_status) ?? 'pending' }
        : a
    ),
    task_status: toTaskStatus(result?.task_status) ?? 'pending',
  };
}

export async function submitCurrent(params: SubmitParams): Promise<SubmitOutcome> {
  const {
    campaignId,
    task,
    currentUserId,
    fields,
    labelId,
    comment,
    confidence,
    isAuthoritative,
    flagged,
    flagComment,
    formValues,
    knnValidationEnabled,
    confirmMismatch,
  } = params;

  // Guard here rather than only in the submit button's disabled state: the
  // Enter hotkey calls this directly and would otherwise reach the backend's
  // 422. Skips (no label) are exempt, matching the backend.
  if (labelId !== null) {
    const { ok, missing } = validateForm(fields, formValues);
    if (!ok) return { kind: 'blocked', missing };
  }

  const userAnnotation = task.annotations.find((a) => a.created_by_user_id === currentUserId);
  const hasExistingLabel = userAnnotation?.label_id != null;

  // Remove label flow: no label chosen, one already existed, and no comment
  // is being added - a bare "take my label off this task".
  if (labelId === null && hasExistingLabel && !comment) {
    try {
      const { data } = await deleteAnnotation({
        path: { campaign_id: campaignId, annotation_id: userAnnotation!.id },
      });
      return { kind: 'removed', task: applyRemoval(task, userAnnotation!.id, currentUserId, data) };
    } catch (error) {
      return { kind: 'error', message: extractErrorMessage(error) };
    }
  }

  if (knnValidationEnabled && labelId !== null && !confirmMismatch) {
    try {
      const validation = await validateAnnotationSubmission({
        path: { campaign_id: campaignId, annotation_task_id: task.id },
        query: { label_id: labelId },
      });
      if (validation.data?.status === 'mismatch') return { kind: 'needsConfirm' };
    } catch {
      // Validation unavailable - don't block the submission on it.
    }
  }

  try {
    const response = await completeAnnotationTask({
      path: { campaign_id: campaignId, annotation_task_id: task.id },
      body: {
        label_id: labelId,
        comment: comment || null,
        confidence,
        is_authoritative: isAuthoritative ?? null,
        flagged_for_review: flagged,
        flag_comment: flagged ? flagComment || null : null,
        form_values: Object.keys(formValues).length ? formValues : null,
      },
    });
    return { kind: 'submitted', task: applySubmission(task, currentUserId, response.data) };
  } catch (error) {
    return { kind: 'error', message: extractErrorMessage(error) };
  }
}
