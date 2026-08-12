import { useEffect } from 'react';
import type { AnnotationTaskOut } from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useSessionStore, useWorkStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../../composition';
import { FormFields } from '../../shared/FormFields';
import { ClaimBadge } from './ClaimBadge';
import { resolveConfirm, setSkipConfirmDisabled, useConfirmDialogState } from './confirmBus';
import {
  DEFAULT_CONFIDENCE,
  submitAnnotation,
  skipCurrent,
  submitAuthoritative,
  taskLabellingPolicy,
} from './hotkeys';
import { LabelGrid } from './LabelGrid';
import { ReviewList } from './ReviewList';
import {
  getCurrentTask,
  goToAnnotationNumber,
  next,
  previous,
  replaceTask,
  setKnnValidationEnabled,
  syncMapFocus,
  useTaskListState,
} from './taskListBus';
import { useClaims } from './useClaims';

/** Populates the work-store form from a task's existing annotation by the
 *  current user, or blanks it for a task with none yet. */
function loadTaskIntoForm(task: AnnotationTaskOut | null, currentUserId: string | null): void {
  const work = useWorkStore.getState();
  const mine = task?.annotations.find((a) => a.created_by_user_id === currentUserId) ?? null;
  work.setSelectedLabelId(mine?.label_id ?? null);
  work.setComment(mine?.comment ?? '');
  work.setConfidence(mine?.confidence ?? DEFAULT_CONFIDENCE);
  work.setFlagged(mine?.flagged_for_review ?? false);
  work.setFlagComment(mine?.flag_comment ?? '');
  work.setFormValues(mine?.form_values ?? {});
  work.setActiveFieldIndex(null);
}

export interface TaskControlsPanelProps {
  ctx: ComposeCtx;
}

export function TaskControlsPanel({ ctx }: TaskControlsPanelProps) {
  const { visibleTasks, currentIndex, currentUserId, loaded, isSubmitting, knnValidationEnabled } =
    useTaskListState();
  const isReviewMode = useSessionStore((s) => s.isReviewMode);
  const confirmDialog = useConfirmDialogState();
  const showAlert = useLayoutStore((s) => s.showAlert);
  const task = visibleTasks[currentIndex] ?? null;

  const selectedLabelId = useWorkStore((s) => s.selectedLabelId);
  const comment = useWorkStore((s) => s.comment);
  const confidence = useWorkStore((s) => s.confidence);
  const flagged = useWorkStore((s) => s.flagged);
  const flagComment = useWorkStore((s) => s.flagComment);
  const formValues = useWorkStore((s) => s.formValues);
  const activeFieldIndex = useWorkStore((s) => s.activeFieldIndex);
  const setSelectedLabelId = useWorkStore((s) => s.setSelectedLabelId);
  const setComment = useWorkStore((s) => s.setComment);
  const setConfidence = useWorkStore((s) => s.setConfidence);
  const setFlagged = useWorkStore((s) => s.setFlagged);
  const setFlagComment = useWorkStore((s) => s.setFlagComment);
  const setFormValues = useWorkStore((s) => s.setFormValues);

  const labels = ctx.campaign.settings.labels;
  const fields = ctx.campaign.settings.form_fields ?? [];
  const isAuthoritativeReviewer = ctx.campaign.viewer_is_authoritative_reviewer ?? false;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload the form and re-center the map whenever the current task identity or user changes, not on every keystroke against it
  useEffect(() => {
    loadTaskIntoForm(task, currentUserId);
    syncMapFocus(ctx.catalog);
  }, [task?.id, currentUserId]);

  useClaims({
    campaignId: ctx.campaign.id,
    taskId: task?.id ?? null,
    currentUserId,
    isReviewMode,
    getTask: getCurrentTask,
    onClaimed: (claimed) => replaceTask(claimed, ctx.catalog),
    onSkip: () => {
      // A 409 means someone else claimed this task first. Advancing silently
      // looks like the app skipping tasks at random.
      showAlert('Someone else is already working on that task - moving to the next one.');
      next(ctx.catalog);
    },
  });

  if (!loaded) {
    return <div className="p-3 text-xs text-neutral-500">Loading tasks…</div>;
  }
  if (!task) {
    return <div className="p-3 text-xs text-neutral-500">No tasks match the current filter.</div>;
  }

  const userAnnotation = task.annotations.find((a) => a.created_by_user_id === currentUserId);
  const hasExistingLabel = userAnnotation?.label_id != null;
  const isRemovingLabel = hasExistingLabel && selectedLabelId === null;
  const { mayLabel, countsTowardCompletion, isAssignedToTask } = taskLabellingPolicy(
    ctx,
    task,
    currentUserId
  );
  const taskHasAssignments = (task.assignments?.length ?? 0) > 0;

  const isBusy = isSubmitting;
  const isSubmitDisabled = isBusy || !mayLabel || (selectedLabelId === null && !isRemovingLabel);
  const isSkipDisabled = isBusy || !isAssignedToTask;
  const submitLabel = isBusy
    ? 'Submitting…'
    : isRemovingLabel
      ? 'Remove Label'
      : hasExistingLabel
        ? 'Update'
        : 'Submit';

  return (
    <div className="w-full h-full bg-white overflow-y-auto">
      <ConfirmDialog
        isOpen={confirmDialog.open}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        isDangerous={confirmDialog.isDangerous}
        showDontAskAgain={confirmDialog.showDontAskAgain}
        onConfirm={(dontAskAgain) => {
          if (dontAskAgain) setSkipConfirmDisabled(true);
          resolveConfirm(true);
        }}
        onCancel={() => resolveConfirm(false)}
      />

      <div className="flex flex-wrap">
        {isReviewMode && <ReviewList task={task} currentUserId={currentUserId} labels={labels} />}

        <div className="flex flex-col gap-1.5 p-3 border-r border-b border-neutral-100 flex-[2] min-w-[10rem]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Label
            </span>
            <div className="flex items-center gap-2">
              <ClaimBadge task={task} currentUserId={currentUserId} now={Date.now()} />
              <label
                className="flex items-center gap-1 text-[10px] text-neutral-500 cursor-pointer select-none"
                title="Validate against prior labels using embedding similarity (kNN)"
              >
                <input
                  type="checkbox"
                  checked={knnValidationEnabled}
                  onChange={(e) => setKnnValidationEnabled(e.target.checked)}
                />
                Validate
              </label>
            </div>
          </div>
          <LabelGrid
            labels={labels}
            selectedId={selectedLabelId}
            onSelect={setSelectedLabelId}
            disabled={isBusy}
          />
        </div>

        <FormFields
          fields={fields}
          values={formValues}
          onChange={setFormValues}
          activeFieldIndex={activeFieldIndex}
          disabled={isBusy}
        />

        <div className="flex flex-col gap-1.5 p-3 border-r border-b border-neutral-100 flex-1 min-w-[10rem]">
          <textarea
            data-task-comment-input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isBusy}
            placeholder="Add a comment…"
            rows={3}
            maxLength={5000}
            className="w-full resize-none px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-2 p-3 border-r border-b border-neutral-100 flex-1 min-w-[10rem]">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Confidence
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={flagged}
                disabled={isBusy}
                title="Flag for reviewer attention"
                onClick={() => setFlagged(!flagged)}
                className={flagged ? 'text-rose-600' : 'text-neutral-400'}
              >
                Flag
              </button>
              <span className="text-xs font-semibold tabular-nums">
                {confidence ?? DEFAULT_CONFIDENCE}/5
              </span>
            </div>
          </div>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            value={confidence ?? DEFAULT_CONFIDENCE}
            onChange={(e) => setConfidence(Number(e.target.value))}
            disabled={isBusy}
            className="w-full"
          />
          {flagged && (
            <textarea
              value={flagComment}
              onChange={(e) => setFlagComment(e.target.value)}
              disabled={isBusy}
              placeholder="Why are you flagging this? (optional)"
              rows={2}
              maxLength={5000}
              className="w-full resize-none px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md disabled:opacity-60"
            />
          )}

          {!mayLabel && (
            <p
              data-testid="policy-not-allowed-notice"
              className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1"
            >
              You are not allowed to label this task in this campaign.
            </p>
          )}
          {mayLabel && taskHasAssignments && !countsTowardCompletion && (
            <p
              data-testid="policy-extra-label-notice"
              className="text-[11px] text-neutral-500 italic"
            >
              Your label will be saved as extra and does not count toward completion.
            </p>
          )}

          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={isSubmitDisabled}
              onClick={() => void submitAnnotation(ctx)}
              className="flex-1 h-8 px-3 text-xs font-medium bg-brand-600 text-white rounded-md disabled:bg-neutral-300"
            >
              {submitLabel}
            </button>
            <button
              type="button"
              disabled={isSkipDisabled}
              title={!isAssignedToTask ? 'You are not assigned to this task' : undefined}
              onClick={() => void skipCurrent(ctx)}
              className="h-8 px-3 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md disabled:opacity-40"
            >
              {isBusy ? 'Submitting…' : 'Skip'}
            </button>
          </div>

          {isAuthoritativeReviewer && (
            <button
              type="button"
              disabled={isSubmitDisabled}
              onClick={() => void submitAuthoritative(ctx)}
              className="w-full h-8 px-3 text-xs font-medium border border-amber-500 text-amber-700 rounded-md disabled:opacity-40"
            >
              {isBusy ? 'Submitting…' : 'Submit authoritative'}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2 p-3 border-b border-neutral-100 flex-1 min-w-[10rem]">
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] font-medium text-neutral-500">Point</label>
            <input
              type="number"
              defaultValue={task.annotation_number}
              min="1"
              max={visibleTasks.length}
              disabled={isBusy}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const num = parseInt(e.currentTarget.value, 10);
                if (!Number.isNaN(num)) goToAnnotationNumber(num, ctx.catalog);
              }}
              className="w-14 px-2 py-1 text-center text-xs border border-neutral-300 rounded tabular-nums"
              title="Press Enter to go"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => previous(ctx.catalog)}
              className="flex-1 px-2 py-1.5 text-xs border border-neutral-200 rounded"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => next(ctx.catalog)}
              className="flex-1 px-2 py-1.5 text-xs border border-neutral-200 rounded"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
