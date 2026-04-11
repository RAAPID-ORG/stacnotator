import { useEffect, useState } from 'react';
import type { AnnotationTaskOut, LabelBase } from '~/api/client';
import { useCampaignStore } from '../stores/campaign.store';
import { useTaskStore } from '../stores/task.store';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';

interface AnnotationControlsProps {
  labels: LabelBase[];
  onSubmit: (
    labelId: number | null,
    comment: string,
    confidence: number,
    isAuthoritative?: boolean
  ) => Promise<void>;
  onNext: () => void;
  onPrevious: () => void;
  onGoToTask: (index: number) => void;
  isSubmitting: boolean;
  totalTasksCount: number | null;
  currentTask: AnnotationTaskOut | null;
  commentInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Annotation controls panel for labeling and navigating annotation tasks
 */
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
  // Use store state for label and comment
  // Form state (selectedLabelId, comment, confidence) is populated by the store's
  // navigation actions (nextTask, previousTask, goToTask, etc.) via getFormStateForTask()
  const selectedLabelId = useTaskStore((s) => s.selectedLabelId);
  const comment = useTaskStore((s) => s.comment);
  const confidence = useTaskStore((s) => s.confidence);
  const isNavigating = useTaskStore((s) => s.isNavigating);
  const knnValidationEnabled = useTaskStore((s) => s.knnValidationEnabled);
  const skipConfirmDisabled = useTaskStore((s) => s.skipConfirmDisabled);
  const setSelectedLabelId = useTaskStore((s) => s.setSelectedLabelId);
  const setComment = useTaskStore((s) => s.setComment);
  const setConfidence = useTaskStore((s) => s.setConfidence);
  const setKnnValidationEnabled = useTaskStore((s) => s.setKnnValidationEnabled);
  const setSkipConfirmDisabled = useTaskStore((s) => s.setSkipConfirmDisabled);

  const campaign = useCampaignStore((s) => s.campaign);
  const hasEmbeddingYear = campaign?.settings?.embedding_year != null;
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const isAuthoritativeReviewer = useCampaignStore((s) => s.isAuthoritativeReviewer);
  const knnStatus = useCampaignStore((s) => s.knnValidationStatus);

  /**
   * Compute whether KNN validation can actually run for the current task +
   * selected label, and return a human-readable reason if not. Null reason
   * means the toggle is usable.
   */
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

  // Local state for goto input
  const [gotoValue, setGotoValue] = useState<string>('');

  // Update goto input when task changes
  useEffect(() => {
    if (currentTask) {
      setGotoValue(currentTask.annotation_number.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when annotation_number changes
  }, [currentTask?.annotation_number]);

  const handleSubmit = async () => {
    await onSubmit(selectedLabelId, comment, confidence);
    // Don't reset form here - let the effect handle it when task changes
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

    await onSubmit(null, comment, confidence);
    // Don't reset form here - let the effect handle it when task changes
  };

  const handleSubmitAuthoritative = async () => {
    const confirmed = await useLayoutStore.getState().showConfirmDialog({
      title: 'Submit as authoritative?',
      description: 'This will mark conflicting tasks as completed.',
      confirmText: 'Submit Authoritative',
      cancelText: 'Cancel',
      isDangerous: true,
    });
    if (!confirmed) return;
    await onSubmit(selectedLabelId, comment, confidence, true);
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
      e.stopPropagation(); // Prevent triggering global keyboard shortcuts
      const num = parseInt(gotoValue, 10);
      if (!isNaN(num) && num > 0 && num <= (totalTasksCount || 0)) {
        handleGoToTask(num);
      }
      // Blur the input after navigating
      e.currentTarget.blur();
    }
  };

  const handleGotoClick = () => {
    const num = parseInt(gotoValue, 10);
    if (!isNaN(num) && num > 0 && num <= (totalTasksCount || 0)) {
      handleGoToTask(num);
    }
  };

  // Disable controls during submission or navigation
  const isDisabled = isSubmitting || isNavigating;

  // Check if current user has already annotated this task
  const currentUserId = useAccountStore((state) => state.account?.id);
  const userAnnotation = currentTask?.annotations.find(
    (a) => a.created_by_user_id === currentUserId
  );
  const _hasExistingAnnotation = userAnnotation !== undefined;
  const hasExistingLabel = userAnnotation !== undefined && userAnnotation.label_id != null;

  // Only users assigned to this task can skip it (skipping submits a
  // null-label annotation).
  const isAssignedToTask =
    currentTask?.assignments?.some((a) => a.user_id === currentUserId) ?? false;

  // Determine submit button text and state
  const isRemovingLabel = hasExistingLabel && selectedLabelId === null;
  const submitButtonText = isRemovingLabel
    ? 'Remove Label'
    : hasExistingLabel
      ? 'Update'
      : 'Submit';
  // Submit is disabled when: loading OR (no label selected AND not removing an existing label)
  const isSubmitDisabled = isDisabled || (selectedLabelId === null && !isRemovingLabel);

  // Show Go button only when user has typed a different value
  const showGoButton = currentTask && gotoValue !== currentTask.annotation_number.toString();

  return (
    <div className="w-full h-full bg-white overflow-y-auto">
      <div className="flex flex-wrap">
        {/* Block 1: Label Selection */}
        <div className="flex flex-col gap-1.5 p-3 border-r border-b border-neutral-200 flex-[2] min-w-[10rem]">
          <span className="font-semibold text-neutral-700 text-xs tracking-wide">Label</span>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((label, index) => (
              <button
                key={label.id}
                disabled={isDisabled}
                className={`w-40 text-left px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors flex justify-between items-center ${
                  selectedLabelId === label.id
                    ? 'bg-brand-50 text-brand-700 border-brand-500 border font-semibold'
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

        {/* Block 2: Comment Field */}
        <div className="flex flex-col gap-1.5 p-3 border-r border-b border-neutral-200 flex-1 min-w-[10rem]">
          <label className="text-xs font-semibold text-neutral-700 tracking-wide">Comment</label>
          <textarea
            ref={commentInputRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isDisabled}
            placeholder="Add a comment..."
            rows={3}
            className="w-full resize-none p-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400 disabled:opacity-50 placeholder:text-neutral-400"
          />
        </div>

        {/* Block 3: Confidence + Submit/Skip */}
        <div className="flex flex-col gap-2 p-3 border-r border-b border-neutral-200 flex-1 min-w-[10rem]">
          {/* Confidence Slider */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-neutral-700 tracking-wide flex justify-between items-center">
              <span>Confidence</span>
              <span className="text-brand-600 font-semibold text-xs tabular-nums">
                {confidence}/5
              </span>
            </label>
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

          {/* Separator */}
          <div className="border-t border-neutral-300"></div>

          {/* KNN Validation Toggle */}
          {knnAvailable ? (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={knnValidationEnabled}
                  onChange={(e) => setKnnValidationEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-7 h-4 bg-neutral-300 rounded-full peer-checked:bg-brand-500 transition-colors"></div>
                <div className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm peer-checked:translate-x-3 transition-transform"></div>
              </div>
              <span className="text-[11px] text-neutral-600">Validate</span>
              <div className="relative group">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-3 h-3 text-neutral-400 group-hover:text-neutral-600 transition-colors cursor-help shrink-0"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 1 0 8.94 6.94ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 px-2.5 py-2 bg-neutral-800 text-white text-[12px] leading-relaxed rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none z-50">
                  Experimental feature - use with care! Checks your label against prior annotations
                  using embedding similarity from AlphaEarth in {campaign?.settings?.embedding_year}{' '}
                  (kNN, with k = {knnStatus?.required_per_label ?? 5}). You&apos;ll be asked to
                  confirm if your label disagrees with the majority.
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></div>
                </div>
              </div>
            </label>
          ) : (
            <div className="flex items-center gap-1.5 select-none">
              <div className="relative">
                <div className="w-7 h-4 bg-neutral-200 rounded-full cursor-not-allowed"></div>
                <div className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm"></div>
              </div>
              <span className="text-[11px] text-neutral-400">Validate</span>
              <div className="relative group">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-3 h-3 text-neutral-300 group-hover:text-neutral-400 transition-colors cursor-help shrink-0"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 1 0 8.94 6.94ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 px-2.5 py-2 bg-neutral-800 text-white text-[12px] leading-relaxed rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none z-50">
                  KNN label validation is unavailable: {knnDisabledReason}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></div>
                </div>
              </div>
            </div>
          )}

          {/* Submit/Skip Buttons */}
          <div className="flex gap-1.5">
            <button
              disabled={isSubmitDisabled}
              onClick={handleSubmit}
              className="flex-1 px-3 py-2 text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isNavigating ? 'Loading...' : isSubmitting ? 'Submitting...' : submitButtonText}
            </button>
            <button
              disabled={isDisabled || !isAssignedToTask}
              onClick={handleSkip}
              title={!isAssignedToTask ? 'You are not assigned to this task' : undefined}
              className="px-3 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-neutral-200"
            >
              Skip
            </button>
          </div>

          {/* Submit as Authoritative (review mode + authoritative reviewer only) */}
          {isReviewMode && isAuthoritativeReviewer && (
            <button
              disabled={isSubmitDisabled}
              onClick={handleSubmitAuthoritative}
              className="w-full px-3 py-2 text-xs font-semibold border border-amber-500 text-amber-700 hover:bg-amber-500 hover:text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Authoritative'}
            </button>
          )}
        </div>

        {/* Block 4: Navigation Controls */}
        {currentTask && totalTasksCount && (
          <div className="flex flex-col gap-2 p-3 border-b border-neutral-200 flex-1 min-w-[10rem]">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">Navigate</span>

            {/* Go to point row */}
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
                className="w-14 px-2 py-1 text-center text-xs text-neutral-900 bg-white border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400 disabled:opacity-50 tabular-nums"
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

            {/* Previous/Next buttons row */}
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

        {/* Block 5: All Annotations (review mode only) */}
        {isReviewMode && currentTask && currentTask.annotations.length > 0 && (
          <div className="flex flex-col gap-1.5 p-3 border-b border-neutral-200 w-full">
            <span className="font-semibold text-neutral-700 text-xs tracking-wide">
              All Annotations
            </span>
            <div className="flex flex-col gap-1.5">
              {/* Sort: own annotation first, then others */}
              {[...currentTask.annotations]
                .sort((a, b) => {
                  if (a.created_by_user_id === currentUserId) return -1;
                  if (b.created_by_user_id === currentUserId) return 1;
                  return 0;
                })
                .map((ann) => {
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

                  return (
                    <div
                      key={ann.id}
                      className={`text-[11px] rounded px-2.5 py-2 border ${
                        ann.is_authoritative
                          ? 'bg-amber-50 border-amber-200'
                          : isOwn
                            ? 'bg-brand-50 border-brand-200'
                            : 'bg-neutral-50 border-neutral-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`font-bold ${isOwn ? 'text-brand-700' : 'text-neutral-700'}`}
                        >
                          {displayName}
                          {ann.is_authoritative && (
                            <span className="ml-1 text-amber-600" title="Authoritative">
                              🗲
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1.5 text-neutral-500">
                          <span
                            className={`font-medium ${isSkipped ? 'text-neutral-500 italic' : 'text-neutral-800'}`}
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
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnotationControls;
