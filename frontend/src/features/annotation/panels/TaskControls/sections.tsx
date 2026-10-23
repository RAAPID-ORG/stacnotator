import { useState } from 'react';
import { IconChevronLeft, IconChevronRight, IconFlag } from '~/shared/ui/Icons';
import { useLayoutStore as useAppLayoutStore } from '~/shared/stores/layout.store';
import { isRemovingLabel, maySubmitTask } from '../../campaign/annotation';
import { FormFields } from '../../components/FormFields';
import { useCampaign, useCampaignStore, useCatalog } from '../../stores/campaign';
import type { AnnotationTaskOut } from '~/api/client';
import { useTasksStore } from '../../stores/tasks';
import { useWorkStore } from '../../stores/work';
import {
  advance,
  DEFAULT_CONFIDENCE,
  finishDrawTask,
  skipCurrent,
  submitAnnotation,
  submitAuthoritative,
  taskLabellingPolicy,
} from '../../taskActions';
import { PointJumper } from './PointJumper';
import { sectionCellClass, sectionHeaderClass } from './styles';

const textareaClass =
  'w-full resize-none px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:bg-neutral-50 disabled:opacity-60 placeholder:text-neutral-400 transition-colors';

const navButtonClass =
  'flex-1 min-w-7 h-7 flex items-center justify-center gap-1 px-2 text-xs font-medium text-neutral-600 border border-neutral-200 rounded hover:bg-neutral-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer';

/** Form fields render one cell each, so they slot into whichever grid holds
 *  them rather than bringing a cell of their own. */
export function FieldsSection() {
  const campaign = useCampaign();
  const isBusy = useTasksStore((s) => s.isSubmitting);
  const formValues = useWorkStore((s) => s.formValues);
  const activeFieldIndex = useWorkStore((s) => s.activeFieldIndex);
  const setFormValues = useWorkStore((s) => s.setFormValues);
  return (
    <FormFields
      fields={campaign.settings.form_fields ?? []}
      values={formValues}
      onChange={setFormValues}
      activeFieldIndex={activeFieldIndex}
      disabled={isBusy}
    />
  );
}

export function CommentSection() {
  const isBusy = useTasksStore((s) => s.isSubmitting);
  const comment = useWorkStore((s) => s.comment);
  const setComment = useWorkStore((s) => s.setComment);
  return (
    <div data-task-comment className={`${sectionCellClass} gap-1.5`}>
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
  );
}

export function ConfidenceSection() {
  const isBusy = useTasksStore((s) => s.isSubmitting);
  const confidence = useWorkStore((s) => s.confidence);
  const flagged = useWorkStore((s) => s.flagged);
  const flagComment = useWorkStore((s) => s.flagComment);
  const setConfidence = useWorkStore((s) => s.setConfidence);
  const setFlagged = useWorkStore((s) => s.setFlagged);
  const setFlagComment = useWorkStore((s) => s.setFlagComment);

  return (
    <div data-task-confidence className={`${sectionCellClass} gap-2`}>
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
    </div>
  );
}

/** Pinned under the scrolling sections, so submitting and moving on stay in
 *  reach however many fields a campaign asks for. The point navigation wraps
 *  onto a line of its own when the panel is too narrow for one row. */
export function ActionBar({ task }: { task: AnnotationTaskOut }) {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const currentUserId = useCampaignStore((s) => s.currentUserId);
  const isBusy = useTasksStore((s) => s.isSubmitting);
  const previous = useTasksStore((s) => s.previous);
  const goToAnnotationNumber = useTasksStore((s) => s.goToAnnotationNumber);
  const selectedLabelId = useWorkStore((s) => s.selectedLabelId);
  const showAlert = useAppLayoutStore((s) => s.showAlert);
  // Kept across tasks: a reviewer settling a batch of tasks settles them all.
  const [authoritative, setAuthoritative] = useState(false);
  const asAuthoritative = authoritative && campaign.viewer_is_authoritative_reviewer === true;
  // A draw task is answered by its shapes: Done replaces Submit.
  const drawTask = campaign.settings.task_output === 'draw';

  const hasExistingLabel =
    task.annotations.find((a) => a.created_by_user_id === currentUserId)?.label_id != null;
  const { mayLabel, countsTowardCompletion, isAssignedToTask } = taskLabellingPolicy(task);
  const taskHasAssignments = (task.assignments?.length ?? 0) > 0;
  const readiness = { selectedLabelId, hasExistingLabel, mayLabel, isSubmitting: isBusy };
  const isSubmitDisabled = !maySubmitTask(readiness);
  // Skipping is labelling with no label, so it is gated the same way. Keying
  // it on assignment would put it out of reach on the whole unassigned pool.
  const isSkipDisabled = isBusy || !mayLabel;
  const submitLabel = isBusy
    ? 'Submitting…'
    : drawTask
      ? 'Done'
      : asAuthoritative
        ? 'Submit authoritative'
        : isRemovingLabel(readiness)
          ? 'Remove Label'
          : hasExistingLabel
            ? 'Update'
            : 'Submit';

  return (
    <div className="shrink-0 flex flex-col gap-1.5 px-3 py-2 border-t border-neutral-200 bg-neutral-50/60">
      {!mayLabel && (
        <p
          data-testid="policy-not-allowed-notice"
          className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1"
        >
          You are not allowed to label this task in this campaign.
        </p>
      )}
      {mayLabel && taskHasAssignments && !countsTowardCompletion && (
        <p data-testid="policy-extra-label-notice" className="text-[11px] text-neutral-500 italic">
          Your label will be saved as extra and does not count toward completion.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-1.5">
          <button
            type="button"
            disabled={isSkipDisabled}
            title={!mayLabel ? 'You are not allowed to label this task' : undefined}
            onClick={() => void skipCurrent()}
            className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 shadow-sm hover:bg-neutral-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Skip
          </button>
          {drawTask && (
            <button
              type="button"
              disabled={isSkipDisabled}
              onClick={() => void finishDrawTask('none_found')}
              className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 shadow-sm hover:bg-neutral-50 rounded-md transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Nothing here
            </button>
          )}
          {campaign.viewer_is_authoritative_reviewer && !drawTask && (
            <label
              className="flex shrink-0 cursor-pointer select-none flex-col items-center gap-0.5"
              title="Submit as authoritative: your label overrides other annotators and completes the task."
            >
              <span className="relative">
                <input
                  type="checkbox"
                  aria-label="Submit as authoritative"
                  checked={authoritative}
                  onChange={(e) => setAuthoritative(e.target.checked)}
                  className="sr-only peer"
                />
                <span className="block w-6 h-3 bg-neutral-300 rounded-full peer-checked:bg-amber-500 transition-colors" />
                <span className="absolute top-0.5 left-0.5 w-2 h-2 bg-white rounded-full shadow-sm peer-checked:translate-x-3 transition-transform" />
              </span>
              <span className="text-[9px] leading-none text-neutral-500">Auth.</span>
            </label>
          )}
          <button
            type="button"
            disabled={drawTask ? isSkipDisabled : isSubmitDisabled}
            onClick={() =>
              void (drawTask
                ? finishDrawTask('drawn')
                : asAuthoritative
                  ? submitAuthoritative()
                  : submitAnnotation())
            }
            title={
              asAuthoritative
                ? isAssignedToTask
                  ? 'Submit as authoritative: overrides any other annotators on this task and marks it completed, even if their labels disagree.'
                  : "Submit as authoritative: this task isn't assigned to you, but your label will be recorded as the canonical answer and the task will be marked completed without needing consensus from assignees."
                : undefined
            }
            className={`flex-1 min-w-0 inline-flex items-center justify-center h-7 px-3 text-xs font-medium text-white rounded-md shadow-sm transition-colors whitespace-nowrap disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none disabled:cursor-not-allowed ${
              asAuthoritative
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {submitLabel}
          </button>
        </div>
        <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-1.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => previous(catalog)}
            aria-label="Previous point"
            title="Previous point"
            className={navButtonClass}
          >
            <IconChevronLeft className="w-3 h-3" />
            <span className="@max-[15rem]:hidden">Prev</span>
          </button>
          <PointJumper
            key={task.annotation_number}
            current={task.annotation_number}
            disabled={isBusy}
            onJump={(num) => goToAnnotationNumber(num, catalog)}
            onNotFound={(num) => showAlert(`Point #${num} is not in the current filter`, 'error')}
          />
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void advance()}
            aria-label="Next point"
            title="Next point"
            className={navButtonClass}
          >
            <span className="@max-[15rem]:hidden">Next</span>
            <IconChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
