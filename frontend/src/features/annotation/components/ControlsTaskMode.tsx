import { useEffect, useState } from 'react';
import type { AnnotationTaskOut, LabelBase } from '~/api/client';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { IconFlag } from '~/shared/ui/Icons';
import { capitalizeFirst } from '~/shared/utils/utility';

interface AnnotationControlsProps {
  labels: LabelBase[];
  onSubmit: (
    labelId: number | null,
    comment: string,
    confidence: number,
    isAuthoritative?: boolean,
    flaggedForReview?: boolean,
    flagComment?: string
  ) => Promise<void>;
  onNext: () => void;
  onPrevious: () => void;
  onGoToTask: (index: number) => void;
  isSubmitting: boolean;
  totalTasksCount: number | null;
  currentTask: AnnotationTaskOut | null;
  commentInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export const AnnotationControls = ({
  labels,
  onSubmit,
  onNext,
  onPrevious,
  onGoToTask,
  isSubmitting,
  currentTask,
  totalTasksCount,
  commentInputRef,
}: AnnotationControlsProps) => {
  // Form state is populated by the store's navigation actions (nextTask,
  // previousTask, goToTask) via getFormStateForTask - not by local useState.
  const selectedLabelId = useTaskStore((s) => s.selectedLabelId);
  const comment = useTaskStore((s) => s.comment);
  const confidence = useTaskStore((s) => s.confidence);
  const flaggedForReview = useTaskStore((s) => s.flaggedForReview);
  const flagComment = useTaskStore((s) => s.flagComment);
  const isNavigating = useTaskStore((s) => s.isNavigating);
  const knnValidationEnabled = useTaskStore((s) => s.knnValidationEnabled);
  const skipConfirmDisabled = useTaskStore((s) => s.skipConfirmDisabled);
  const setSelectedLabelId = useTaskStore((s) => s.setSelectedLabelId);
  const setComment = useTaskStore((s) => s.setComment);
  const setConfidence = useTaskStore((s) => s.setConfidence);
  const setFlaggedForReview = useTaskStore((s) => s.setFlaggedForReview);
  const setFlagComment = useTaskStore((s) => s.setFlagComment);
  const setKnnValidationEnabled = useTaskStore((s) => s.setKnnValidationEnabled);
  const setSkipConfirmDisabled = useTaskStore((s) => s.setSkipConfirmDisabled);

  const campaign = useCampaignStore((s) => s.campaign);
  const hasEmbeddingYear = campaign?.settings?.embedding_year != null;
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const isAuthoritativeReviewer = useCampaignStore((s) => s.isAuthoritativeReviewer);
  const knnStatus = useCampaignStore((s) => s.knnValidationStatus);

  const knnDisabledReason: string | null = (() => {
    if (!hasEmbeddingYear) {
      return 'No embedding year has been configured for this campaign. Set it in Campaign Settings to enable this feature.';
    }
    if (campaign?.embedding_status === 'registering') {
      return 'Satellite embeddings are still being computed for this campaign. Try again once that finishes.';
    }
    if (campaign?.embedding_status === 'failed') {
      return 'Embedding generation failed for this campaign - KNN validation cannot run. See Campaign Settings for details.';
    }
    if (currentTask && !currentTask.has_embedding) {
      return 'No embedding exists for this specific task, so validation will be skipped here. Other tasks may still validate.';
    }
    if (knnStatus) {
      const { required_total, required_per_label, total_labeled_with_embedding, per_label_counts } =
        knnStatus;
      if (total_labeled_with_embedding < required_total) {
        const missing = required_total - total_labeled_with_embedding;
        return `Not enough labeled annotations yet to build a neighbour set. Need at least ${required_total} total, have ${total_labeled_with_embedding} (${missing} more needed).`;
      }
      if (selectedLabelId != null) {
        const current = per_label_counts[String(selectedLabelId)] ?? 0;
        if (current < required_per_label) {
          const missing = required_per_label - current;
          const labelName = labels.find((l) => l.id === selectedLabelId)?.name ?? 'this label';
          return `Not enough prior annotations of "${labelName}" to validate against (need ${required_per_label}, have ${current} - ${missing} more needed).`;
        }
      }
    }
    return null;
  })();
  const knnAvailable = knnDisabledReason === null;

  const [gotoValue, setGotoValue] = useState<string>('');

  useEffect(() => {
    if (currentTask) {
      setGotoValue(currentTask.annotation_number.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when annotation_number changes
  }, [currentTask?.annotation_number]);

  const handleSubmit = async () => {
    await onSubmit(selectedLabelId, comment, confidence, undefined, flaggedForReview, flagComment);
  };

  const handleSkip = async () => {
    if (!skipConfirmDisabled) {
      const confirmed = await useLayoutStore.getState().showConfirmDialog({
        title: 'Skip annotation?',
        description: 'You can come back to it later.',
        confirmText: 'Skip',
        cancelText: 'Cancel',
        showDontAskAgain: true,
        onDontAskAgain: () => setSkipConfirmDisabled(true),
      });

      if (!confirmed) return;
    }

    await onSubmit(null, comment, confidence, undefined, flaggedForReview, flagComment);
  };

  const handleSubmitAuthoritative = async () => {
    const confirmed = await useLayoutStore.getState().showConfirmDialog({
      title: 'Submit as authoritative?',
      description:
        'Your label will be recorded as the canonical answer for this task and mark it completed, overriding any other annotators and skipping consensus from assignees.',
      confirmText: 'Submit Authoritative',
      cancelText: 'Cancel',
      isDangerous: true,
    });
    if (!confirmed) return;
    await onSubmit(selectedLabelId, comment, confidence, true, flaggedForReview, flagComment);
  };

  const handleGoToTask = (annotationNumber: number) => {
    if (annotationNumber > 0) {
      const visibleTasks = useTaskStore.getState().visibleTasks;
      const exists = visibleTasks.some((t) => t.annotation_number === annotationNumber);
      if (exists) {
        onGoToTask(annotationNumber);
      } else {
        useLayoutStore
          .getState()
          .showAlert(`Point #${annotationNumber} is not in the current filter`, 'error');
      }
    }
  };

  const handleGotoKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const num = parseInt(gotoValue, 10);
      if (!isNaN(num) && num > 0 && num <= (totalTasksCount || 0)) {
        handleGoToTask(num);
      }
      e.currentTarget.blur();
    }
  };

  const handleGotoClick = () => {
    const num = parseInt(gotoValue, 10);
    if (!isNaN(num) && num > 0 && num <= (totalTasksCount || 0)) {
      handleGoToTask(num);
    }
  };

  const isDisabled = isSubmitting || isNavigating;

  const currentUserId = useAccountStore((state) => state.account?.id);
  const userAnnotation = currentTask?.annotations.find(
    (a) => a.created_by_user_id === currentUserId
  );
  const _hasExistingAnnotation = userAnnotation !== undefined;
  const hasExistingLabel = userAnnotation !== undefined && userAnnotation.label_id != null;

  // Skipping submits a null-label annotation, so only assignees may skip.
  const isAssignedToTask =
    currentTask?.assignments?.some((a) => a.user_id === currentUserId) ?? false;

  const isRemovingLabel = hasExistingLabel && selectedLabelId === null;
  const submitButtonText = isRemovingLabel
    ? 'Remove Label'
    : hasExistingLabel
      ? 'Update'
      : 'Submit';
  const isSubmitDisabled = isDisabled || (selectedLabelId === null && !isRemovingLabel);

  const showGoButton = currentTask && gotoValue !== currentTask.annotation_number.toString();

  return (
    <div className="w-full h-full bg-white overflow-y-auto">
      <div className="flex flex-wrap">
        {isReviewMode &&
          currentTask &&
          ((currentTask.annotations?.length ?? 0) > 0 ||
            (currentTask.assignments?.length ?? 0) > 0) && (
            <div className="flex flex-col gap-1.5 p-3 border-b border-neutral-100 w-full">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                  All Annotations
                </span>
                {currentTask.task_status === 'conflicting' && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-semibold uppercase tracking-wide border border-orange-300">
                    <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 2 1 18h18L10 2Zm0 5.5 5.5 9.5h-11L10 7.5Zm-.75 3v3.5h1.5V10.5h-1.5Zm0 4.5V16h1.5v-1.5h-1.5Z" />
                    </svg>
                    Conflict
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {(() => {
                  // One entry per assignee: their annotation if present,
                  // otherwise a "pending" placeholder. Orphan annotations
                  // (annotator with no matching assignment) are appended so
                  // we never silently drop data.
                  type Entry =
                    | { kind: 'annotation'; annotation: (typeof currentTask.annotations)[number] }
                    | {
                        kind: 'pending';
                        assignment: NonNullable<typeof currentTask.assignments>[number];
                      };

                  const annByUser = new Map(
                    currentTask.annotations.map((a) => [a.created_by_user_id, a])
                  );
                  const entries: Entry[] = [];
                  const seenUserIds = new Set<string>();

                  for (const assn of currentTask.assignments ?? []) {
                    seenUserIds.add(assn.user_id);
                    const ann = annByUser.get(assn.user_id);
                    if (ann) {
                      entries.push({ kind: 'annotation', annotation: ann });
                    } else {
                      entries.push({ kind: 'pending', assignment: assn });
                    }
                  }
                  for (const ann of currentTask.annotations) {
                    if (!seenUserIds.has(ann.created_by_user_id)) {
                      entries.push({ kind: 'annotation', annotation: ann });
                    }
                  }

                  // Own entry last, everyone else in assignment order.
                  entries.sort((a, b) => {
                    const aOwn =
                      a.kind === 'annotation'
                        ? a.annotation.created_by_user_id === currentUserId
                        : a.assignment.user_id === currentUserId;
                    const bOwn =
                      b.kind === 'annotation'
                        ? b.annotation.created_by_user_id === currentUserId
                        : b.assignment.user_id === currentUserId;
                    if (aOwn && !bOwn) return 1;
                    if (!aOwn && bOwn) return -1;
                    return 0;
                  });

                  return entries.map((entry) => {
                    if (entry.kind === 'pending') {
                      const assn = entry.assignment;
                      const isOwn = assn.user_id === currentUserId;
                      const displayName = isOwn
                        ? 'You'
                        : assn.user_display_name || assn.user_email || assn.user_id.substring(0, 8);
                      return (
                        <div
                          key={`pending-${assn.user_id}`}
                          className="text-[11px] rounded px-2.5 py-2 border border-dashed border-neutral-300 bg-neutral-50"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-neutral-500">{displayName}</span>
                            <span className="text-neutral-400 italic">Not labeled yet</span>
                          </div>
                        </div>
                      );
                    }

                    const ann = entry.annotation;
                    const isOwn = ann.created_by_user_id === currentUserId;
                    const assignment = currentTask.assignments?.find(
                      (a) => a.user_id === ann.created_by_user_id
                    );
                    const isSkipped = assignment?.status === 'skipped';
                    const displayName = isOwn
                      ? 'You'
                      : assignment?.user_display_name ||
                        assignment?.user_email ||
                        ann.created_by_user_id.substring(0, 8);
                    const label = labels.find((l) => l.id === ann.label_id);
                    const labelName = label
                      ? capitalizeFirst(label.name)
                      : ann.label_id
                        ? `#${ann.label_id}`
                        : isSkipped
                          ? 'Skipped'
                          : '-';

                    // Authoritative amber beats conflict orange.
                    const isConflict =
                      currentTask.task_status === 'conflicting' && !ann.is_authoritative;
                    const cardClass = ann.is_authoritative
                      ? 'bg-amber-50 border-amber-200'
                      : isConflict
                        ? 'bg-orange-50 border-orange-300'
                        : isOwn
                          ? 'bg-brand-50 border-brand-200'
                          : 'bg-neutral-50 border-neutral-200';

                    return (
                      <div
                        key={ann.id}
                        className={`text-[11px] rounded px-2.5 py-2 border ${cardClass}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-bold ${
                              isConflict
                                ? 'text-orange-700'
                                : isOwn
                                  ? 'text-brand-700'
                                  : 'text-neutral-700'
                            }`}
                          >
                            {displayName}
                            {ann.is_authoritative && (
                              <span className="ml-1 text-amber-600" title="Authoritative">
                                🗲
                              </span>
                            )}
                            {ann.flagged_for_review && (
                              <span
                                className="ml-1 inline-flex items-center align-middle text-rose-600"
                                title={ann.flag_comment || 'Flagged for review'}
                              >
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 20 20"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.75"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M4 17V3M4 3h10l-2 4 2 4H4" />
                                </svg>
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1.5 text-neutral-500">
                            <span
                              className={`font-medium ${
                                isSkipped
                                  ? 'text-neutral-500 italic'
                                  : isConflict
                                    ? 'text-orange-800'
                                    : 'text-neutral-800'
                              }`}
                            >
                              {labelName}
                            </span>
                            {ann.confidence !== null && ann.confidence !== undefined && (
                              <>
                                <span className="text-neutral-300">|</span>
                                <span title="Confidence">{ann.confidence}/5</span>
                              </>
                            )}
                          </div>
                        </div>
                        {ann.comment && ann.comment.trim() !== '' && (
                          <div className="mt-1 text-neutral-600 italic whitespace-pre-wrap">
                            &ldquo;{ann.comment}&rdquo;
                          </div>
                        )}
                        {ann.flagged_for_review &&
                          ann.flag_comment &&
                          ann.flag_comment.trim() !== '' && (
                            <div className="mt-1 text-rose-700 italic whitespace-pre-wrap">
                              Flag: &ldquo;{ann.flag_comment}&rdquo;
                            </div>
                          )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

        <div className="flex flex-col gap-1.5 p-3 border-r border-b border-neutral-100 flex-[2] min-w-[10rem]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Label
            </span>
            {knnAvailable ? (
              <label
                className="flex items-center gap-1.5 cursor-pointer select-none"
                title={`Validate against prior labels using embedding similarity (kNN, k=${knnStatus?.required_per_label ?? 5})`}
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
            ) : (
              <span
                className="flex items-center gap-1.5 select-none opacity-60"
                title={`Validation unavailable: ${knnDisabledReason}`}
              >
                <span className="relative">
                  <span className="block w-6 h-3 bg-neutral-200 rounded-full" />
                  <span className="absolute top-0.5 left-0.5 w-2 h-2 bg-white rounded-full shadow-sm" />
                </span>
                <span className="text-[10px] text-neutral-400">Validate</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((label, index) => (
              <button
                key={label.id}
                disabled={isDisabled}
                className={`w-40 text-left px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors flex justify-between items-center ${
                  selectedLabelId === label.id
                    ? 'bg-brand-50 text-brand-700 border-brand-600 border font-semibold'
                    : 'bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-400 text-neutral-700 border-neutral-200 border'
                } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                onClick={() => setSelectedLabelId(selectedLabelId === label.id ? null : label.id)}
              >
                <span className="truncate">
                  {selectedLabelId === label.id ? '✓ ' : ''}
                  {capitalizeFirst(label.name)}
                </span>
                <span className="text-neutral-400 text-[10px] ml-1 tabular-nums">{index + 1}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 p-3 border-r border-b border-neutral-100 flex-1 min-w-[10rem]">
          <textarea
            ref={commentInputRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isDisabled}
            placeholder="Add a comment…"
            rows={3}
            className="w-full resize-none px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:bg-neutral-50 disabled:opacity-60 placeholder:text-neutral-400 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-2 p-3 border-r border-b border-neutral-100 flex-1 min-w-[10rem]">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                Confidence
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFlaggedForReview(!flaggedForReview)}
                  disabled={isDisabled}
                  aria-pressed={flaggedForReview}
                  title={
                    flaggedForReview
                      ? 'Flagged for reviewer attention. Click or press F to unflag.'
                      : "Flag this annotation for reviewer attention. Useful when you're unsure about the label and want a reviewer to take a second look. Press F to toggle."
                  }
                  className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    flaggedForReview
                      ? 'text-rose-600 bg-rose-50 hover:bg-rose-100'
                      : 'text-neutral-400 hover:text-rose-600 hover:bg-neutral-100'
                  }`}
                >
                  <IconFlag className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-brand-700 font-semibold tabular-nums">
                  {confidence}/5
                </span>
              </div>
            </div>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              disabled={isDisabled}
              className="w-full h-2 bg-neutral-200 rounded-full appearance-none cursor-pointer accent-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex justify-between text-[10px] text-neutral-400 px-0.5 tabular-nums">
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <span>5</span>
            </div>
          </div>

          {flaggedForReview && (
            <textarea
              value={flagComment}
              onChange={(e) => setFlagComment(e.target.value)}
              disabled={isDisabled}
              placeholder="Why are you flagging this? (optional)"
              rows={2}
              className="w-full resize-none px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:bg-neutral-50 disabled:opacity-60 placeholder:text-neutral-400 transition-colors"
            />
          )}

          <div className="flex gap-1.5">
            <button
              disabled={isSubmitDisabled}
              onClick={handleSubmit}
              className="flex-1 inline-flex items-center justify-center h-8 px-3 text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 rounded-md shadow-sm transition-colors disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none disabled:cursor-not-allowed"
              type="button"
            >
              {isNavigating ? 'Loading…' : isSubmitting ? 'Submitting…' : submitButtonText}
            </button>
            <button
              disabled={isDisabled || !isAssignedToTask}
              onClick={handleSkip}
              title={!isAssignedToTask ? 'You are not assigned to this task' : undefined}
              className="inline-flex items-center justify-center h-8 px-3 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 shadow-sm hover:bg-neutral-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
            >
              Skip
            </button>
          </div>

          {isAuthoritativeReviewer && (
            <button
              disabled={isSubmitDisabled}
              onClick={handleSubmitAuthoritative}
              title={
                isAssignedToTask
                  ? 'Submit as authoritative: overrides any other annotators on this task and marks it completed, even if their labels disagree.'
                  : "Submit as authoritative: this task isn't assigned to you, but your label will be recorded as the canonical answer and the task will be marked completed without needing consensus from assignees."
              }
              className="w-full inline-flex items-center justify-center h-8 px-3 text-xs font-medium border border-amber-500 text-amber-700 hover:bg-amber-500 hover:text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
            >
              {isSubmitting ? 'Submitting…' : 'Submit authoritative'}
            </button>
          )}
        </div>

        {currentTask && totalTasksCount && (
          <div className="flex flex-col gap-2 p-3 border-b border-neutral-100 flex-1 min-w-[10rem]">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-medium text-neutral-500">Point</label>
              <input
                type="number"
                value={gotoValue}
                onChange={(e) => setGotoValue(e.target.value)}
                onKeyDown={handleGotoKeyDown}
                disabled={isDisabled}
                min="1"
                max={totalTasksCount}
                className="w-14 px-2 py-1 text-center text-xs text-neutral-900 bg-white border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-400 disabled:opacity-50 tabular-nums"
                title="Press Enter to go"
              />
              {showGoButton && (
                <button
                  disabled={isDisabled}
                  onClick={handleGotoClick}
                  className="px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-neutral-200"
                  title="Go to annotation"
                >
                  Go
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                disabled={isDisabled}
                onClick={onPrevious}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer border border-neutral-200"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Prev
              </button>

              <button
                disabled={isDisabled}
                onClick={onNext}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer border border-neutral-200"
              >
                Next
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnotationControls;
