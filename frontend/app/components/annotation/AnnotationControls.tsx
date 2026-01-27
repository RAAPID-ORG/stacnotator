import { useEffect, useState } from 'react';
import type { AnnotationTaskItemOut, LabelBase } from '~/api/client';
import { useAnnotationStore } from '~/stores/annotationStore';
import { capitalizeFirst } from '~/utils/utility';

interface AnnotationControlsProps {
  labels: LabelBase[];
  onSubmit: (labelId: number | null, comment: string) => Promise<void>;
  onNext: () => void;
  onPrevious: () => void;
  onGoToTask: (index: number) => void;
  isSubmitting: boolean;
  totalTasksCount: number | null;
  currentTask: AnnotationTaskItemOut | null;
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
  const selectedLabelId = useAnnotationStore((state) => state.selectedLabelId);
  const comment = useAnnotationStore((state) => state.comment);
  const isNavigating = useAnnotationStore((state) => state.isNavigating);
  const setSelectedLabelId = useAnnotationStore((state) => state.setSelectedLabelId);
  const setComment = useAnnotationStore((state) => state.setComment);
  const resetAnnotationForm = useAnnotationStore((state) => state.resetAnnotationForm);

  // Local state for goto input
  const [gotoValue, setGotoValue] = useState<string>('');

  // Load existing annotation when task changes
  useEffect(() => {
    if (currentTask?.annotation) {
      setSelectedLabelId(currentTask.annotation.label_id);
      setComment(currentTask.annotation.comment || '');
    } else {
      resetAnnotationForm();
    }
  }, [currentTask?.id, setSelectedLabelId, setComment, resetAnnotationForm]);

  // Update goto input when task changes
  useEffect(() => {
    if (currentTask) {
      setGotoValue(currentTask.annotation_number.toString());
    }
  }, [currentTask?.annotation_number]);

  const handleSubmit = async () => {
    await onSubmit(selectedLabelId, comment);
    // Don't reset form here - let the effect handle it when task changes
  };

  const handleSkip = async () => {
    const confirmed = window.confirm('Skip this annotation? You can come back to it later.');

    if (!confirmed) return;

    await onSubmit(null, comment);
    // Don't reset form here - let the effect handle it when task changes
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

  // Check if task already has a label (annotation exists)
  const hasExistingLabel = currentTask?.annotation !== null;

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
    <div className="w-40 flex flex-col gap-2 p-2 bg-white overflow-y-auto h-full">
      {/* Label Selection */}
      <div className="flex flex-col gap-1">
        <span className="font-bold text-neutral-900">Annotation</span>
        {labels.map((label, index) => (
          <button
            key={label.id}
            disabled={isDisabled}
            className={`w-full text-left px-2 py-1.5 text-[10px] font-bold rounded-sm transition-colors flex justify-between items-center ${
              selectedLabelId === label.id
                ? 'bg-neutral-100 text-brand-700 border-brand-500 border-2 font-semibold'
                : 'bg-neutral-100 hover:border-brand-500 text-neutral-800 border-neutral-100 border-2'
            } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={() => setSelectedLabelId(selectedLabelId === label.id ? null : label.id)}
          >
            <span>
              {selectedLabelId === label.id ? '✓ ' : '+ '}
              {capitalizeFirst(label.name)}
            </span>
            <span className="text-neutral-400 text-[9px]">[{index + 1}]</span>
          </button>
        ))}
      </div>

      {/* Comment Field */}
      <div className="flex flex-col gap-1 mt-2">
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
          className="w-full resize-none p-1.5 text-[10px] text-neutral-900 bg-neutral-50 border border-neutral-300 rounded-sm focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        />
      </div>

      {/* Submit/Skip Buttons */}
      <div className="flex gap-1 mt-2">
        <button
          disabled={isSubmitDisabled}
          onClick={handleSubmit}
          className="flex-1 px-3 py-1.5 text-md font-bold border border-brand-500 text-brand-700 hover:bg-brand-500 hover:text-white rounded-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isNavigating ? 'Loading...' : isSubmitting ? 'Submitting...' : submitButtonText}
        </button>
        <button
          disabled={isDisabled}
          onClick={handleSkip}
          className="px-2 py-1.5 text-md font-normal border border-neutral-300 text-neutral-900 hover:bg-neutral-100 rounded-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Skip
        </button>
      </div>

      {/* Navigation Controls */}
      {currentTask && totalTasksCount && (
        <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-neutral-300">
          {/* Go to point row - centered */}
          <div className="flex items-center justify-center gap-1">
            <label className="text-[12px] font-medium font-bold text-neutral-600"> Point:</label>
            <input
              type="number"
              value={gotoValue}
              onChange={(e) => setGotoValue(e.target.value)}
              onKeyDown={handleGotoKeyDown}
              disabled={isDisabled}
              min="1"
              max={totalTasksCount}
              className="w-10 p-1 text-center text-[12px] text-neutral-900 bg-neutral-50 border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
              title="Press Enter to go"
            />
            {showGoButton && (
              <button
                disabled={isDisabled}
                onClick={handleGotoClick}
                className="px-1 py-1 text-[12px] font-bold border border-neutral-300 text-neutral-700 hover:bg-neutral-100 rounded-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Go to annotation"
              >
                Go
              </button>
            )}
          </div>

          {/* Previous/Next buttons row - half width each */}
          <div className="flex items-center gap-1">
            <button
              disabled={isDisabled}
              onClick={onPrevious}
              className="flex-1 px-1 py-1.5 text-[12px] font-bold border border-neutral-300 text-neutral-900 hover:bg-neutral-100 rounded-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
            >
              &lt; Prev
            </button>

            <button
              disabled={isDisabled}
              onClick={onNext}
              className="flex-1 px-1 py-1.5 text-[12px] font-bold border border-neutral-300 text-neutral-900 hover:bg-neutral-100 rounded-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
            >
              Next &gt;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnnotationControls;
