import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AnnotationTaskOut } from '~/api/client';
import { IconChevronLeft, IconChevronRight, IconFlag } from '~/shared/ui/Icons';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { isLabelGroupActive, isRemovingLabel, maySubmitTask } from '../../domain/annotation';
import { useCampaign, useCampaignStore, useCatalog } from '../../stores/campaign';
import { useWorkStore } from '../../stores/work';
import { activeGroupClass, FormFields } from '../../components/FormFields';
import {
  DEFAULT_CONFIDENCE,
  skipCurrent,
  submitAnnotation,
  submitAuthoritative,
  taskLabellingPolicy,
} from '../../taskActions';
import { LabelGrid } from './LabelGrid';
import { ReviewList } from './ReviewList';
import { currentTask, useTasksStore } from '../../stores/tasks';
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

const sectionHeaderClass = (active = false) =>
  `text-[11px] font-medium uppercase tracking-wider ${
    active ? 'text-brand-700' : 'text-neutral-500'
  }`;

const textareaClass =
  'w-full resize-none px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:bg-neutral-50 disabled:opacity-60 placeholder:text-neutral-400 transition-colors';

const navButtonClass =
  'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-neutral-600 border border-neutral-200 rounded hover:bg-neutral-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer';

export function TaskControls() {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const currentUserId = useCampaignStore((s) => s.currentUserId);
  const {
    visibleTasks,
    currentIndex,
    loaded,
    isSubmitting,
    knnValidationEnabled,
    goToAnnotationNumber,
    next,
    previous,
    replaceTask,
    setKnnValidationEnabled,
  } = useTasksStore(
    useShallow((state) => ({
      visibleTasks: state.visibleTasks,
      currentIndex: state.currentIndex,
      loaded: state.loaded,
      isSubmitting: state.isSubmitting,
      knnValidationEnabled: state.knnValidationEnabled,
      goToAnnotationNumber: state.goToAnnotationNumber,
      next: state.next,
      previous: state.previous,
      replaceTask: state.replaceTask,
      setKnnValidationEnabled: state.setKnnValidationEnabled,
    }))
  );
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const [gotoValue, setGotoValue] = useState('');
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

  const labels = campaign.settings.labels;
  const fields = campaign.settings.form_fields ?? [];
  const labelGroupActive = isLabelGroupActive(activeFieldIndex, fields.length);
  const isAuthoritativeReviewer = campaign.viewer_is_authoritative_reviewer ?? false;

  useEffect(() => {
    loadTaskIntoForm(task, currentUserId);
    setGotoValue(task ? String(task.annotation_number) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload the form whenever the current task identity or user changes, not on every object replacement or keystroke against it
  }, [task?.id, currentUserId]);

  useClaims({
    campaignId: campaign.id,
    taskId: task?.id ?? null,
    currentUserId,
    isReviewMode,
    getTask: currentTask,
    onClaimed: (claimed) => replaceTask(claimed, catalog),
    onSkip: () => {
      // A 409 means someone else claimed this task first. Advancing silently
      // looks like the app skipping tasks at random.
      showAlert('Someone else is already working on that task - moving to the next one.');
      next(catalog);
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
  const { mayLabel, countsTowardCompletion, isAssignedToTask } = taskLabellingPolicy(task);
  const taskHasAssignments = (task.assignments?.length ?? 0) > 0;

  const isBusy = isSubmitting;
  const readiness = { selectedLabelId, hasExistingLabel, mayLabel, isSubmitting: isBusy };
  const removingLabel = isRemovingLabel(readiness);
  const isSubmitDisabled = !maySubmitTask(readiness);
  const isSkipDisabled = isBusy || !isAssignedToTask;
  const submitLabel = isBusy
    ? 'Submitting…'
    : removingLabel
      ? 'Remove Label'
      : hasExistingLabel
        ? 'Update'
        : 'Submit';

  const goToTyped = () => {
    const num = parseInt(gotoValue, 10);
    if (Number.isNaN(num) || num < 1) return;
    if (!goToAnnotationNumber(num, catalog)) {
      showAlert(`Point #${num} is not in the current filter`, 'error');
    }
  };
  const showGoButton = gotoValue !== String(task.annotation_number);

  return (
    <div className="w-full h-full bg-white overflow-y-auto">
      <div className="flex flex-wrap">
        {isReviewMode && <ReviewList task={task} currentUserId={currentUserId} labels={labels} />}

        <div
          data-task-labels
          tabIndex={-1}
          className={`flex flex-col gap-1.5 p-3 border-r border-b border-neutral-100 flex-[2] min-w-[10rem] ${
            labelGroupActive ? activeGroupClass : ''
          } focus:outline-none`}
        >
          <span className={sectionHeaderClass(labelGroupActive)}>Label</span>
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

        <div
          data-task-comment
          className="flex flex-col gap-1.5 p-3 border-r border-b border-neutral-100 flex-1 min-w-[10rem]"
        >
          <textarea
            data-task-comment-input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isBusy}
            placeholder="Add a comment…"
            rows={3}
            maxLength={5000}
            className={textareaClass}
          />
        </div>

        <div
          data-task-confidence
          className="flex flex-col gap-2 p-3 border-r border-b border-neutral-100 flex-1 min-w-[10rem]"
        >
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <span className={sectionHeaderClass()}>Confidence</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={flagged}
                  disabled={isBusy}
                  title={
                    flagged
                      ? 'Flagged for reviewer attention. Click or press F to unflag.'
                      : "Flag this annotation for reviewer attention. Useful when you're unsure about the label and want a reviewer to take a second look. Press F to toggle."
                  }
                  onClick={() => setFlagged(!flagged)}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    flagged
                      ? 'text-rose-600 bg-rose-50 hover:bg-rose-100'
                      : 'text-neutral-400 hover:text-rose-600 hover:bg-neutral-100'
                  }`}
                >
                  <IconFlag className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-brand-700 font-semibold tabular-nums">
                  {confidence ?? DEFAULT_CONFIDENCE}/5
                </span>
              </div>
            </div>
            <input
              data-task-confidence-input
              type="range"
              min="1"
              max="5"
              step="1"
              value={confidence ?? DEFAULT_CONFIDENCE}
              onChange={(e) => setConfidence(Number(e.target.value))}
              disabled={isBusy}
              className="w-full h-2 bg-neutral-200 rounded-full appearance-none cursor-pointer accent-brand-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex justify-between text-[10px] text-neutral-400 px-0.5 tabular-nums">
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <span>5</span>
            </div>
          </div>

          {flagged && (
            <textarea
              value={flagComment}
              onChange={(e) => setFlagComment(e.target.value)}
              disabled={isBusy}
              placeholder="Why are you flagging this? (optional)"
              rows={2}
              maxLength={5000}
              className={textareaClass}
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

          <label
            className="flex items-center gap-1.5 cursor-pointer select-none"
            title="Validate against prior labels using embedding similarity (kNN)"
          >
            <span className="relative">
              <input
                type="checkbox"
                checked={knnValidationEnabled}
                onChange={(e) => setKnnValidationEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <span className="block w-6 h-3 bg-neutral-300 rounded-full peer-checked:bg-brand-600 transition-colors" />
              <span className="absolute top-0.5 left-0.5 w-2 h-2 bg-white rounded-full shadow-sm peer-checked:translate-x-3 transition-transform" />
            </span>
            <span className="text-[10px] text-neutral-600">Validate</span>
          </label>

          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={isSubmitDisabled}
              onClick={() => void submitAnnotation()}
              className="flex-1 inline-flex items-center justify-center h-8 px-3 text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 rounded-md shadow-sm transition-colors disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {submitLabel}
            </button>
            <button
              type="button"
              disabled={isSkipDisabled}
              title={!isAssignedToTask ? 'You are not assigned to this task' : undefined}
              onClick={() => void skipCurrent()}
              className="inline-flex items-center justify-center h-8 px-3 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 shadow-sm hover:bg-neutral-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Skip
            </button>
          </div>

          {isAuthoritativeReviewer && (
            <button
              type="button"
              disabled={isSubmitDisabled}
              onClick={() => void submitAuthoritative()}
              title={
                isAssignedToTask
                  ? 'Submit as authoritative: overrides any other annotators on this task and marks it completed, even if their labels disagree.'
                  : "Submit as authoritative: this task isn't assigned to you, but your label will be recorded as the canonical answer and the task will be marked completed without needing consensus from assignees."
              }
              className="w-full inline-flex items-center justify-center h-8 px-3 text-xs font-medium border border-amber-500 text-amber-700 hover:bg-amber-500 hover:text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isBusy ? 'Submitting…' : 'Submit authoritative'}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2 p-3 border-b border-neutral-100 flex-1 min-w-[10rem]">
          <div className="flex items-center gap-1.5">
            <label className={sectionHeaderClass()}>Point</label>
            <input
              type="number"
              value={gotoValue}
              onChange={(e) => setGotoValue(e.target.value)}
              min="1"
              max={visibleTasks.length}
              disabled={isBusy}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                e.stopPropagation();
                goToTyped();
                e.currentTarget.blur();
              }}
              className="w-14 px-2 py-1 text-center text-xs text-neutral-900 bg-white border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-400 disabled:opacity-50 tabular-nums"
              title="Press Enter to go"
            />
            {showGoButton && (
              <button
                type="button"
                disabled={isBusy}
                onClick={goToTyped}
                title="Go to annotation"
                className="px-2 py-1 text-xs font-medium text-neutral-600 border border-neutral-200 rounded hover:bg-neutral-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Go
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => previous(catalog)}
              className={navButtonClass}
            >
              <IconChevronLeft className="w-3 h-3" />
              Prev
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => next(catalog)}
              className={navButtonClass}
            >
              Next
              <IconChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
