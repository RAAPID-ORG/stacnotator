import { isAudienceMember, type PolicyContext } from '~/features/annotation/core/annotation';
import { useSessionStore, useWorkStore, type WorkMode } from '~/features/annotation/stores';
import { useLayoutStore } from '~/shared/stores/layout.store';
import type { CampaignOutFull } from '~/api/client';
import type { TaskFilter } from '~/features/annotation/core/tasks';
import { bumpAnnotationVersion } from '../../shared/annotationVersion';

export interface ModeSwitchProps {
  campaign: CampaignOutFull;
  hasTasks: boolean;
  policy: PolicyContext;
  /** Widens the task filter on entering review mode. */
  onTaskFilterChange: (patch: Partial<TaskFilter>) => void;
}

export function ModeSwitch({ campaign, hasTasks, policy, onTaskFilterChange }: ModeSwitchProps) {
  const workMode = useSessionStore((s) => s.workMode);
  const isReviewMode = useSessionStore((s) => s.isReviewMode);
  const setWorkMode = useSessionStore((s) => s.setWorkMode);
  const setReviewMode = useSessionStore((s) => s.setReviewMode);
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
    const outcome = await useWorkStore
      .getState()
      .closeDraft(campaign.id, campaign.settings.form_fields ?? []);
    if (outcome === 'save-failed') {
      showAlert(
        'Could not save the open annotation - it is still here, retry before switching.',
        'error'
      );
      return;
    }
    if (outcome === 'saved') bumpAnnotationVersion();
    setWorkMode(mode);
  };

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
    <div className="flex items-center gap-1">
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
            !exploreAllowed
              ? 'Explore labelling is not enabled for you in this campaign'
              : undefined
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

      {workMode === 'tasks' && (
        <button
          type="button"
          onClick={toggleReview}
          title={isReviewMode ? 'Exit review mode' : 'Enter review mode'}
          data-testid="review-toggle"
          data-tour="review-toggle"
          className={`px-2 py-1 text-sm rounded transition-colors ${
            isReviewMode
              ? 'bg-amber-50 text-amber-700 font-medium'
              : 'text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          Review{isReviewMode ? ' ✓' : ''}
        </button>
      )}
    </div>
  );
}
