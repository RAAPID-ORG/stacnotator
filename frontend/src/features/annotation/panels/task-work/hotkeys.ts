import type { AnnotationTaskOut, LabelBase } from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import {
  handleFormFieldKey,
  isAudienceMember,
  type PolicyContext,
} from '~/features/annotation/core/annotation';
import { useWorkStore } from '~/features/annotation/stores';
import type { Binding } from '~/features/annotation/engine/hotkeys';
import type { ComposeCtx, HotkeyTable } from '../../composition';
import { focusFormFieldInput } from '../../shared/FormFields';
import { isSkipConfirmDisabled, requestConfirm } from './confirmBus';
import { submitCurrent, type SubmitOutcome } from './submit';
import {
  getCurrentTask,
  getTaskListState,
  next,
  previous,
  replaceTask,
  setSubmitting,
} from './taskListBus';

// A two-keystroke debounce for a picker with at most a couple dozen labels.
const DIGIT_BUFFER_TIMEOUT_MS = 500;
export const DEFAULT_CONFIDENCE = 5;

let digitBuffer = '';
let digitTimer: ReturnType<typeof setTimeout> | null = null;

function clearDigitBuffer(): void {
  if (digitTimer) clearTimeout(digitTimer);
  digitTimer = null;
  digitBuffer = '';
}

function selectLabelByPosition(labels: LabelBase[], position: number): void {
  const label = labels[position - 1];
  if (!label) return;
  const work = useWorkStore.getState();
  work.setSelectedLabelId(work.selectedLabelId === label.id ? null : label.id);
}

function processDigitBuffer(labels: LabelBase[]): void {
  const num = parseInt(digitBuffer, 10);
  clearDigitBuffer();
  if (!Number.isNaN(num) && num > 0) selectLabelByPosition(labels, num);
}

/** Buffers up to two digits so a two-digit label index (e.g. "12") can be
 *  entered as two keystrokes rather than jumping to label 1 on the first. */
function handleDigitInput(digit: string, labels: LabelBase[]): void {
  if (digitTimer) clearTimeout(digitTimer);
  digitBuffer += digit;
  const currentNum = parseInt(digitBuffer, 10);
  const canAddMoreDigits = currentNum * 10 <= labels.length;
  if (currentNum > labels.length || !canAddMoreDigits || digitBuffer.length >= 2) {
    processDigitBuffer(labels);
  } else {
    digitTimer = setTimeout(() => processDigitBuffer(labels), DIGIT_BUFFER_TIMEOUT_MS);
  }
}

/** Test/teardown seam, mirrors main-map's stopSliceAutoNav. */
export function resetDigitBuffer(): void {
  clearDigitBuffer();
}

// --- Labelling policy --------------------------------------------------
// An unassigned task is gated by unassigned_tasks for both axes, so mayLabel and
// countsTowardCompletion only ever diverge on an assigned task (a label that
// "counts" is a strict subset of one that "may" be given at all). Fails open
// (true) with no task/policy loaded yet - UX-only, the server remains the
// authority regardless.

export interface TaskPolicy {
  mayLabel: boolean;
  countsTowardCompletion: boolean;
  isAssignedToTask: boolean;
}

export function taskLabellingPolicy(
  ctx: ComposeCtx,
  task: AnnotationTaskOut | null,
  currentUserId: string | null
): TaskPolicy {
  const isAssignedToTask = task?.assignments?.some((a) => a.user_id === currentUserId) ?? false;
  const policy = ctx.campaign.settings.labelling_policy;
  if (!task || !policy) return { mayLabel: true, countsTowardCompletion: true, isAssignedToTask };

  const taskHasAssignments = (task.assignments?.length ?? 0) > 0;
  const policyCtx: PolicyContext = {
    userId: currentUserId,
    isAdmin: ctx.campaign.viewer_is_admin ?? false,
    isAuthoritative: ctx.campaign.viewer_is_authoritative_reviewer ?? false,
    isMember: ctx.campaign.viewer_is_member ?? false,
    isAssigned: isAssignedToTask,
  };
  const mayLabel = isAudienceMember(
    taskHasAssignments ? policy.assigned_tasks : policy.unassigned_tasks,
    policyCtx
  );
  const countsTowardCompletion = isAudienceMember(
    taskHasAssignments ? policy.complete_assigned : policy.unassigned_tasks,
    policyCtx
  );
  return { mayLabel, countsTowardCompletion, isAssignedToTask };
}

// --- Submit / skip / authoritative --------------------------------------

interface RunSubmitOptions {
  labelId: number | null;
  isAuthoritative?: boolean;
  confirmMismatch?: boolean;
}

async function runSubmit(ctx: ComposeCtx, options: RunSubmitOptions): Promise<SubmitOutcome> {
  const task = getCurrentTask();
  const { currentUserId, knnValidationEnabled } = getTaskListState();
  const work = useWorkStore.getState();
  const fields = ctx.campaign.settings.form_fields ?? [];

  if (!task || !currentUserId) {
    return { kind: 'error', message: 'No current task to submit' };
  }

  const outcome = await submitCurrent({
    campaignId: ctx.campaign.id,
    task,
    currentUserId,
    fields,
    labelId: options.labelId,
    comment: work.comment,
    confidence: work.confidence ?? DEFAULT_CONFIDENCE,
    isAuthoritative: options.isAuthoritative,
    flagged: work.flagged,
    flagComment: work.flagComment,
    formValues: work.formValues,
    knnValidationEnabled,
    confirmMismatch: options.confirmMismatch,
  });

  const { showAlert } = useLayoutStore.getState();
  if (outcome.kind === 'blocked') {
    showAlert(`Missing required: ${outcome.missing.join(', ')}`, 'error');
  } else if (outcome.kind === 'error') {
    showAlert(outcome.message, 'error');
  } else if (outcome.kind === 'submitted') {
    replaceTask(outcome.task, ctx.catalog);
    next(ctx.catalog);
  } else if (outcome.kind === 'removed') {
    replaceTask(outcome.task, ctx.catalog);
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

/** Runs `body` only while no submit is already in flight - the in-flight
 *  guard both the Submit/Skip/Authoritative buttons (via isSubmitting) and
 *  this early return enforce. */
async function guardedSubmit(body: () => Promise<void>): Promise<void> {
  if (getTaskListState().isSubmitting) return;
  setSubmitting(true);
  try {
    await body();
  } finally {
    setSubmitting(false);
  }
}

/** Submit (or update) the current task's label, with the KNN mismatch
 *  confirm loop folded in - a 'needsConfirm' result re-asks and, on
 *  confirmation, resubmits with the check skipped. Blocked by the
 *  labelling policy (mayLabel) the same way the button's disabled state is. */
export async function submitAnnotation(ctx: ComposeCtx): Promise<void> {
  const { currentUserId } = getTaskListState();
  const { mayLabel } = taskLabellingPolicy(ctx, getCurrentTask(), currentUserId);
  if (!mayLabel) {
    const { showAlert } = useLayoutStore.getState();
    showAlert('You are not allowed to label this task in this campaign.', 'error');
    return;
  }
  await guardedSubmit(async () => {
    const work = useWorkStore.getState();
    const first = await runSubmit(ctx, { labelId: work.selectedLabelId });
    if (first.kind !== 'needsConfirm') return;
    if (await requestConfirm(MISMATCH_CONFIRM)) {
      await runSubmit(ctx, { labelId: work.selectedLabelId, confirmMismatch: true });
    }
  });
}

/** Skip: submits with no label, clearing any label of ours on this task.
 *  Only an assignee can skip - skipping submits a
 *  null-label annotation, which only makes sense against an assignment. */
export async function skipCurrent(ctx: ComposeCtx): Promise<void> {
  const { currentUserId } = getTaskListState();
  const { isAssignedToTask } = taskLabellingPolicy(ctx, getCurrentTask(), currentUserId);
  if (!isAssignedToTask) {
    useLayoutStore.getState().showAlert('You are not assigned to this task.', 'error');
    return;
  }
  if (!isSkipConfirmDisabled()) {
    const confirmed = await requestConfirm({
      title: 'Skip annotation?',
      description: 'You can come back to it later.',
      confirmText: 'Skip',
      cancelText: 'Cancel',
      showDontAskAgain: true,
    });
    if (!confirmed) return;
  }
  await guardedSubmit(async () => {
    await runSubmit(ctx, { labelId: null });
  });
}

/** Submits as the canonical, authoritative answer - overrides other
 *  annotators and marks the task done regardless of consensus. */
export async function submitAuthoritative(ctx: ComposeCtx): Promise<void> {
  const { currentUserId } = getTaskListState();
  const { mayLabel } = taskLabellingPolicy(ctx, getCurrentTask(), currentUserId);
  if (!mayLabel) {
    const { showAlert } = useLayoutStore.getState();
    showAlert('You are not allowed to label this task in this campaign.', 'error');
    return;
  }
  const confirmed = await requestConfirm({
    title: 'Submit as authoritative?',
    description:
      'Your label will be recorded as the canonical answer for this task and mark it completed, overriding any other annotators and skipping consensus from assignees.',
    confirmText: 'Submit Authoritative',
    cancelText: 'Cancel',
    isDangerous: true,
  });
  if (!confirmed) return;

  await guardedSubmit(async () => {
    const work = useWorkStore.getState();
    const first = await runSubmit(ctx, { labelId: work.selectedLabelId, isAuthoritative: true });
    if (first.kind !== 'needsConfirm') return;
    if (await requestConfirm(MISMATCH_CONFIRM)) {
      await runSubmit(ctx, {
        labelId: work.selectedLabelId,
        isAuthoritative: true,
        confirmMismatch: true,
      });
    }
  });
}

function commentBox(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-task-comment-input]');
}

function focusComment(): void {
  commentBox()?.focus();
}

function commentIsFocused(): boolean {
  const box = commentBox();
  return box !== null && document.activeElement === box;
}

const FORM_INPUT_SELECTOR = '[data-form-field-id],[data-task-comment-input]';

/** Whether the form's Tab/Escape may claim this keystroke. They are allowed
 *  through the registry's typing guard so a focused field can be left again,
 *  which would otherwise hijack Tab and Escape inside every other input on the
 *  page (search boxes, dialogs) - those stay with the browser. */
function formKeysApply(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return true;
  const tag = active.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return true;
  return active.closest(FORM_INPUT_SELECTOR) !== null;
}

function adjustConfidence(delta: number): void {
  const work = useWorkStore.getState();
  const current = work.confidence ?? DEFAULT_CONFIDENCE;
  work.setConfidence(Math.max(1, Math.min(5, current + delta)));
}

export function taskWorkBindings(ctx: ComposeCtx): Binding[] {
  const tasksActive = () => ctx.mode === 'tasks';
  const labels = ctx.campaign.settings.labels;

  // Below 10 labels a single keystroke always resolves the selection, so only
  // the digits that name a real label are bound; at 10+, two-digit numbers
  // are reachable and every digit can appear in either position.
  const labelDigits =
    labels.length >= 10
      ? ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
      : Array.from({ length: labels.length }, (_, i) => String(i + 1));
  const labelHelp =
    labels.length >= 10 ? 'Select label by number (two digits for 10+)' : 'Select label by number';

  const digitBinding = (digit: string): Binding => ({
    key: digit,
    help: labelHelp,
    when: tasksActive,
    run: () => handleDigitInput(digit, labels),
  });

  // Shift+<digit> produces a symbol rather than the digit, and a different one
  // per keyboard layout; matchKey resolves digit specs through `e.code`, so
  // 'shift+1' is both the binding that fires and the label the help panel and
  // the tooltips render.
  const confidenceBinding = (level: 1 | 2 | 3 | 4 | 5): Binding => ({
    key: `shift+${level}`,
    help: 'Set confidence level',
    when: tasksActive,
    run: () => useWorkStore.getState().setConfidence(level),
  });

  return [
    ...labelDigits.map(digitBinding),
    ...([1, 2, 3, 4, 5] as const).map(confidenceBinding),

    { key: 'w', help: 'Previous task', when: tasksActive, run: () => previous(ctx.catalog) },
    { key: 's', help: 'Next task', when: tasksActive, run: () => next(ctx.catalog) },
    { key: 'q', help: 'Decrease confidence', when: tasksActive, run: () => adjustConfidence(-1) },
    { key: 'e', help: 'Increase confidence', when: tasksActive, run: () => adjustConfidence(1) },
    { key: 'c', help: 'Focus comment', when: tasksActive, run: focusComment },
    {
      key: 'f',
      help: 'Toggle flag for review',
      when: tasksActive,
      run: () => {
        const work = useWorkStore.getState();
        work.setFlagged(!work.flagged);
      },
    },
    {
      key: 'enter',
      help: 'Submit',
      when: tasksActive,
      run: () => {
        void submitAnnotation(ctx).catch((error) =>
          handleError(error, 'Could not submit the annotation')
        );
      },
    },
  ];
}

export function taskFormBindings(ctx: ComposeCtx): Binding[] {
  const formCtx = () => {
    const work = useWorkStore.getState();
    return {
      fields: ctx.campaign.settings.form_fields ?? [],
      activeIndex: work.activeFieldIndex,
      values: work.formValues,
      setValues: work.setFormValues,
      setActiveIndex: work.setActiveFieldIndex,
    };
  };
  const activeField = () => {
    const { fields, activeIndex } = formCtx();
    return activeIndex !== null && activeIndex >= 0 ? fields[activeIndex] : undefined;
  };

  /** domain decides which field a key moves to; the focus call is ours.
   *  handleFormFieldKey never names a field for Tab (the new slot may be a
   *  category field or the label picker, neither with an input) or Escape
   *  (there is no field to focus), so those two keys are handled here from
   *  the post-move store state and the live DOM focus instead. */
  const runFormKey = (e: KeyboardEvent) => {
    const { focusFieldId } = handleFormFieldKey(e, formCtx());
    if (focusFieldId !== null) {
      focusFormFieldInput(focusFieldId);
      return;
    }
    if (e.key === 'Tab') {
      const field = activeField();
      if (field) focusFormFieldInput(field.id);
      return;
    }
    if (e.key === 'Escape') {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest(FORM_INPUT_SELECTOR)) active.blur();
    }
  };

  const digitBinding = (digit: string): Binding => ({
    key: digit,
    help: 'Answer the focused field',
    when: () => activeField() !== undefined,
    run: runFormKey,
  });

  return [
    ...['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digitBinding),
    // Tab and Escape are the way back out of a field the previous Enter (or a
    // click) focused, so they have to survive the registry's typing guard -
    // without allowInInput the form scope goes dead the moment it is used.
    {
      key: 'tab',
      help: 'Cycle form fields',
      allowInInput: true,
      when: () => formCtx().fields.length > 0 && formKeysApply(),
      run: runFormKey,
    },
    {
      key: 'shift+tab',
      help: 'Cycle form fields backward',
      allowInInput: true,
      when: () => formCtx().fields.length > 0 && formKeysApply(),
      run: runFormKey,
    },
    {
      key: 'escape',
      help: 'Unfocus the active field',
      allowInInput: true,
      // The comment box is focused by its own 'c' binding and has no other way
      // out, so Escape blurs it too - otherwise every key stays swallowed by
      // the textarea until the user reaches for the mouse.
      when: () => formKeysApply() && (formCtx().activeIndex !== null || commentIsFocused()),
      run: (e) => {
        if (commentIsFocused()) commentBox()?.blur();
        runFormKey(e);
      },
    },
    {
      key: 'enter',
      help: 'Focus the active field',
      when: () => {
        const field = activeField();
        return field !== undefined && field.type !== 'category' && field.type !== 'multicategory';
      },
      run: runFormKey,
    },
  ];
}

export function taskWorkHotkeys(ctx: ComposeCtx): HotkeyTable[] {
  return [
    // The 'mode' table is tasks-only: Explore's own 'mode' table needs the
    // digits, Enter and E for its tools, and registerBindings rejects a key
    // already live in a scope whatever the bindings' `when` guards say.
    // The 'form' table stays registered in both modes - it navigates the very
    // same work-store formValues/activeFieldIndex, which Explore's questions
    // catalog and its label-vector form use too, and its keys collide with
    // nothing in Explore.
    ...(ctx.mode === 'tasks' ? [{ scope: 'mode' as const, table: taskWorkBindings(ctx) }] : []),
    { scope: 'form', table: taskFormBindings(ctx) },
  ];
}
