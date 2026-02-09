import { useEffect, useState } from 'react';
import type { AnnotationTaskOut, LabelBase } from '~/api/client';
import useAnnotationStore from '../annotation.store';
import { useAccountStore } from '~/features/account/account.store';
import { capitalizeFirst } from '~/shared/utils/utility';

interface AnnotationControlsProps {
  labels: LabelBase[];
  onSubmit: (labelId: number | null, comment: string, confidence: number, isAuthoritative?: boolean) => Promise<void>;
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
  const selectedLabelId = useAnnotationStore((state) => state.selectedLabelId);
  const comment = useAnnotationStore((state) => state.comment);
  const confidence = useAnnotationStore((state) => state.confidence);
  const isNavigating = useAnnotationStore((state) => state.isNavigating);
  const isReviewMode = useAnnotationStore((state) => state.isReviewMode);
  const isAuthoritativeReviewer = useAnnotationStore((state) => state.isAuthoritativeReviewer);
  const setSelectedLabelId = useAnnotationStore((state) => state.setSelectedLabelId);
  const setComment = useAnnotationStore((state) => state.setComment);
  const setConfidence = useAnnotationStore((state) => state.setConfidence);

  // Local state for goto input
  const [gotoValue, setGotoValue] = useState<string>('');

  // Update goto input when task changes
  useEffect(() => {
    if (currentTask) {
      setGotoValue(currentTask.annotation_number.toString());
    }
  }, [currentTask?.annotation_number]);

  const handleSubmit = async () => {
    await onSubmit(selectedLabelId, comment, confidence);
    // Don't reset form here - let the effect handle it when task changes
  };

  const handleSkip = async () => {
    const confirmed = window.confirm('Skip this annotation? You can come back to it later.');

    if (!confirmed) return;

    await onSubmit(null, comment, confidence);
    // Don't reset form here - let the effect handle it when task changes
  };

  const handleSubmitAuthoritative = async () => {
    const confirmed = window.confirm(
      'Submit as authoritative? This will mark conflicting tasks as completed.'
    );
    if (!confirmed) return;
    await onSubmit(selectedLabelId, comment, confidence, true);
  };

  const handleGoToTask = (annotationNumber: number) => {
    if (annotationNumber > 0) {
      onGoToTask(annotationNumber);
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
  const userAnnotation = currentTask?.annotations.find(a => a.created_by_user_id === currentUserId);
  const hasExistingLabel = userAnnotation !== undefined;

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
          <span className="font-bold text-neutral-900 text-xs">Annotation</span>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((label, index) => (
              <button
                key={label.id}
                disabled={isDisabled}
                className={`w-40 text-left px-2 py-1.5 text-[10px] font-bold rounded transition-colors flex justify-between items-center ${
                  selectedLabelId === label.id
                    ? 'bg-neutral-100 text-brand-700 border-brand-500 border-2 font-semibold'
                    : 'bg-neutral-100 hover:border-brand-500 text-neutral-800 border-neutral-200 border-2'
                } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                onClick={() => setSelectedLabelId(selectedLabelId === label.id ? null : label.id)}
              >
                <span className="truncate">
                  {selectedLabelId === label.id ? '✓ ' : '+ '}
                  {capitalizeFirst(label.name)}
                </span>
                <span className="text-neutral-400 text-[9px] ml-1">[{index + 1}]</span>
              </button>
            ))}
          </div>
        </div>

        {/* Block 2: Comment Field */}
        <div className="flex flex-col gap-1.5 p-3 border-r border-b border-neutral-200 flex-1 min-w-[10rem]">
          <label className="text-[10px] font-bold text-neutral-900 uppercase tracking-wide">
            Comment
          </label>
          <textarea
            ref={commentInputRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isDisabled}
            placeholder="Add a comment..."
            rows={3}
            className="w-full resize-none p-1.5 text-[10px] text-neutral-900 bg-neutral-50 border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
          />
        </div>

        {/* Block 3: Confidence + Submit/Skip */}
        <div className="flex flex-col gap-2 p-3 border-r border-b border-neutral-200 flex-1 min-w-[10rem]">
          {/* Confidence Slider */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-neutral-900 uppercase tracking-wide flex justify-between items-center">
              <span>Confidence</span>
              <span className="text-brand-600 font-bold text-xs">{confidence}</span>
            </label>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              disabled={isDisabled}
              className="w-full h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex justify-between text-[8px] text-neutral-400 px-0.5">
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <span>5</span>
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-neutral-300"></div>

          {/* Submit/Skip Buttons */}
          <div className="flex gap-1">
            <button
              disabled={isSubmitDisabled}
              onClick={handleSubmit}
              className="flex-1 px-2 py-1.5 text-xs font-bold border border-brand-500 text-brand-700 hover:bg-brand-500 hover:text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isNavigating ? 'Loading...' : isSubmitting ? 'Submitting...' : submitButtonText}
            </button>
            <button
              disabled={isDisabled}
              onClick={handleSkip}
              className="px-2 py-1.5 text-xs font-normal border border-neutral-300 text-neutral-900 hover:bg-neutral-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Skip
            </button>
          </div>

          {/* Submit as Authoritative (review mode + authoritative reviewer only) */}
          {isReviewMode && isAuthoritativeReviewer && (
            <button
              disabled={isSubmitDisabled}
              onClick={handleSubmitAuthoritative}
              className="w-full px-2 py-1.5 text-xs font-bold border-2 border-amber-500 text-amber-700 hover:bg-amber-500 hover:text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Submitting...' : '🗲 Submit Authoritative'}
            </button>
          )}
        </div>

        {/* Block 4: Navigation Controls */}
        {currentTask && totalTasksCount && (
          <div className="flex flex-col gap-1.5 p-3 border-b border-neutral-200 flex-1 min-w-[10rem]">
            <span className="font-bold text-neutral-900 text-xs">Navigation</span>
            
            {/* Go to point row */}
            <div className="flex items-center gap-1">
              <label className="text-[10px] font-medium text-neutral-600">Point:</label>
              <input
                type="number"
                value={gotoValue}
                onChange={(e) => setGotoValue(e.target.value)}
                onKeyDown={handleGotoKeyDown}
                disabled={isDisabled}
                min="1"
                max={totalTasksCount}
                className="w-14 p-1 text-center text-[10px] text-neutral-900 bg-white border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
                title="Press Enter to go"
              />
              {showGoButton && (
                <button
                  disabled={isDisabled}
                  onClick={handleGotoClick}
                  className="px-1.5 py-1 text-[10px] font-bold border border-neutral-300 text-neutral-700 hover:bg-neutral-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Go to annotation"
                >
                  Go
                </button>
              )}
            </div>

            {/* Separator */}
            <div className="border-t border-neutral-300"></div>

            {/* Previous/Next buttons row */}
            <div className="flex items-center gap-1">
              <button
                disabled={isDisabled}
                onClick={onPrevious}
                className="flex-1 px-2 py-1.5 text-[10px] font-bold border border-neutral-300 text-neutral-900 hover:bg-neutral-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
              >
                &lt; Prev
              </button>

              <button
                disabled={isDisabled}
                onClick={onNext}
                className="flex-1 px-2 py-1.5 text-[10px] font-bold border border-neutral-300 text-neutral-900 hover:bg-neutral-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
              >
                Next &gt;
              </button>
            </div>
          </div>
        )}

        {/* Block 5: All Annotations (review mode only) */}
        {isReviewMode && currentTask && currentTask.annotations.length > 0 && (
          <div className="flex flex-col gap-1.5 p-3 border-b border-neutral-200 w-full">
            <span className="font-bold text-neutral-900 text-xs">All Annotations</span>
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
                  const displayName = isOwn
                    ? 'You'
                    : assignment?.user_display_name || assignment?.user_email || ann.created_by_user_id.substring(0, 8);
                  const label = labels.find((l) => l.id === ann.label_id);
                  const labelName = label ? capitalizeFirst(label.name) : ann.label_id ? `#${ann.label_id}` : '—';

                  return (
                    <div
                      key={ann.id}
                      className={`text-[10px] rounded px-2 py-1.5 border ${
                        ann.is_authoritative
                          ? 'bg-amber-50 border-amber-300'
                          : isOwn
                            ? 'bg-brand-50 border-brand-200'
                            : 'bg-neutral-50 border-neutral-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-bold ${isOwn ? 'text-brand-700' : 'text-neutral-700'}`}>
                          {displayName}
                          {ann.is_authoritative && (
                            <span className="ml-1 text-amber-600" title="Authoritative">🗲</span>
                          )}
                        </span>
                        <div className="flex items-center gap-1.5 text-neutral-500">
                          <span className="font-medium text-neutral-800">{labelName}</span>
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
