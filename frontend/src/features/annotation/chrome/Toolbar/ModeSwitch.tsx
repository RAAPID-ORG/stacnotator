import { isAudienceMember, type PolicyContext } from '~/features/campaigns/utils/labellingPolicy';
import { useCampaignStore } from '../../stores/campaign';
import { switchWorkMode } from '../../keymap';
import { IconClose, IconEyeFilled } from '~/shared/ui/Icons';
import type { CampaignOutFull } from '~/api/client';
import { reviewFilterPatch, type TaskFilter } from '../../campaign/tasks';

export interface ModeSwitchProps {
  campaign: CampaignOutFull;
  hasTasks: boolean;
  policy: PolicyContext;
}

export interface ReviewToggleProps {
  /** Widens the task filter on entering review mode. */
  onTaskFilterChange: (patch: Partial<TaskFilter>) => void;
}

export function ModeSwitch({ campaign, hasTasks, policy }: ModeSwitchProps) {
  const workMode = useCampaignStore((s) => s.workMode);

  const exploreAllowed = isAudienceMember(campaign.settings.labelling_policy.explore, policy);

  // The draft handling and the alert live with the M binding in keymap.ts, so
  // clicking and pressing the key cannot drift apart.
  const switchMode = switchWorkMode;

  return (
    <div
      className="flex items-center bg-neutral-100 rounded-md p-0.5"
      title="Work style"
      data-testid="work-mode-switch"
    >
      <button
        type="button"
        onClick={() => void switchMode('tasks')}
        disabled={!hasTasks}
        title={!hasTasks ? 'This campaign has no tasks yet' : undefined}
        className={`px-2 py-0.5 text-xs rounded transition-colors ${
          workMode === 'tasks'
            ? 'bg-white text-neutral-900 shadow-sm'
            : hasTasks
              ? 'text-neutral-500 hover:text-neutral-800'
              : 'text-neutral-300 cursor-not-allowed'
        }`}
      >
        Tasks
      </button>
      <button
        type="button"
        onClick={() => void switchMode('explore')}
        disabled={!exploreAllowed}
        title={
          !exploreAllowed ? 'Explore labelling is not enabled for you in this campaign' : undefined
        }
        className={`px-2 py-0.5 text-xs rounded transition-colors ${
          workMode === 'explore'
            ? 'bg-white text-neutral-900 shadow-sm'
            : exploreAllowed
              ? 'text-neutral-500 hover:text-neutral-800'
              : 'text-neutral-300 cursor-not-allowed'
        }`}
      >
        Explore
      </button>
    </div>
  );
}

/** Which task Explore's new shapes get linked to, with a way to drop the link
 *  once the annotator has wandered somewhere unrelated. */
export function OriginTaskChip() {
  const workMode = useCampaignStore((s) => s.workMode);
  const originTask = useCampaignStore((s) => s.originTask);
  if (workMode !== 'explore' || !originTask) return null;

  return (
    <div
      className="flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs rounded-md bg-red-50 text-red-700"
      title="New annotations are saved as found near this task"
      data-testid="origin-task-chip"
    >
      <span>Near task #{originTask.annotationNumber}</span>
      <button
        type="button"
        onClick={() => useCampaignStore.getState().setOriginTask(null)}
        className="p-0.5 rounded hover:bg-red-100"
        aria-label="Unlink from task"
        title="Unlink from task"
      >
        <IconClose className="h-3 w-3" />
      </button>
    </div>
  );
}

export function ReviewToggle({ onTaskFilterChange }: ReviewToggleProps) {
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const setReviewMode = useCampaignStore((s) => s.setReviewMode);

  const toggleReview = () => {
    const turningOn = !isReviewMode;
    setReviewMode(turningOn);
    // Pending tasks have nothing to review yet, so entering review mode
    // widens the filter to everything else; leaving it only clears the
    // review-only refinements (confidence/flagged).
    onTaskFilterChange(
      turningOn
        ? reviewFilterPatch()
        : { selectedLabelIds: [], selectedConfidences: [], flaggedOnly: false }
    );
  };

  return (
    <button
      type="button"
      onClick={toggleReview}
      title={isReviewMode ? 'Exit review mode' : 'Enter review mode'}
      data-testid="review-toggle"
      className={`flex items-center gap-1.5 px-2 desktop:px-3 py-1.5 text-sm transition-colors ${
        isReviewMode
          ? 'bg-amber-50 text-amber-700 font-medium'
          : 'text-neutral-700 hover:bg-neutral-50'
      }`}
    >
      <IconEyeFilled
        className={`w-4 h-4 ${isReviewMode ? 'text-amber-600' : 'text-neutral-500'}`}
      />
      <span className="hidden desktop:inline">Review{isReviewMode ? ' ✓' : ''}</span>
    </button>
  );
}
