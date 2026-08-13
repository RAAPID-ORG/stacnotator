import { isAudienceMember, type PolicyContext } from '../../domain/annotation';
import { useCampaignStore, type WorkMode } from '../../stores/campaign';
import { useWorkStore } from '../../stores/work';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { IconEyeFilled } from '~/shared/ui/Icons';
import type { CampaignOutFull } from '~/api/client';
import type { TaskFilter } from '../../domain/tasks';

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
  const setWorkMode = useCampaignStore((s) => s.setWorkMode);
  const showAlert = useLayoutStore((s) => s.showAlert);

  const exploreAllowed = isAudienceMember(campaign.settings.labelling_policy.explore, policy);

  /**
   * Resolve Explore's open draft before the mode actually changes. Both modes
   * answer the same work-store form, so a draft left open would go on
   * collecting the task form's label, comment and answers and write them onto
   * a shape the user drew in the other mode. Closing it is Escape's own
   * disposition (complete saves, incomplete discards); a failed save keeps the
   * draft parked for a retry, which only Explore can offer, so the switch is
   * called off and said out loud.
   */
  const switchMode = async (mode: WorkMode) => {
    if (mode === workMode) return;
    const outcome = await useWorkStore.getState().closeDraft();
    if (outcome === 'save-failed') {
      showAlert(
        'Could not save the open annotation - it is still here, retry before switching.',
        'error'
      );
      return;
    }
    if (outcome === 'saved') useWorkStore.getState().bumpVersion();
    setWorkMode(mode);
  };

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
        ? {
            assignedTo: [],
            statuses: ['partial', 'done', 'skipped', 'conflicting'],
            selectedConfidences: [],
            flaggedOnly: false,
          }
        : { selectedConfidences: [], flaggedOnly: false }
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
