import { useTranslation } from 'react-i18next';
import { isAudienceMember, type PolicyContext } from '~/features/campaigns/utils/labellingPolicy';
import { useCampaignStore } from '../../stores/campaign';
import { switchWorkMode } from '../../keymap';
import { BarButton } from '~/shared/ui/BarButton';
import { IconClose, IconEye } from '~/shared/ui/Icons';
import { SegmentedControl } from '~/shared/ui/SegmentedControl';
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
  const { t } = useTranslation('annotation');
  const workMode = useCampaignStore((s) => s.workMode);

  const exploreAllowed = isAudienceMember(campaign.settings.labelling_policy.explore, policy);

  // The draft handling and the alert live with the M binding in keymap.ts, so
  // clicking and pressing the key cannot drift apart.
  const switchMode = switchWorkMode;

  return (
    <SegmentedControl
      size="bar"
      aria-label={t('modeSwitch.title')}
      title={t('modeSwitch.title')}
      data-testid="work-mode-switch"
      value={workMode}
      onChange={(mode) => void switchMode(mode)}
      segments={[
        {
          value: 'tasks',
          label: t('modeSwitch.tasks'),
          disabled: !hasTasks,
          title: !hasTasks ? t('modeSwitch.noTasks') : undefined,
        },
        {
          value: 'explore',
          label: t('modeSwitch.explore'),
          disabled: !exploreAllowed,
          title: !exploreAllowed ? t('modeSwitch.exploreNotAllowed') : undefined,
        },
      ]}
    />
  );
}

/** Which task Explore's new shapes get linked to, with a way to drop the link
 *  once the annotator has wandered somewhere unrelated. */
export function OriginTaskChip() {
  const { t } = useTranslation('annotation');
  const workMode = useCampaignStore((s) => s.workMode);
  const originTask = useCampaignStore((s) => s.originTask);
  if (workMode !== 'explore' || !originTask) return null;

  return (
    <div
      className="flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs rounded-md bg-red-50 text-red-700"
      title={t('originTask.tip')}
      data-testid="origin-task-chip"
    >
      <span>{t('originTask.label', { number: originTask.annotationNumber })}</span>
      <button
        type="button"
        onClick={() => useCampaignStore.getState().setOriginTask(null)}
        className="p-0.5 rounded hover:bg-red-100"
        aria-label={t('originTask.unlink')}
        title={t('originTask.unlink')}
      >
        <IconClose className="h-3 w-3" />
      </button>
    </div>
  );
}

export function ReviewToggle({ onTaskFilterChange }: ReviewToggleProps) {
  const { t } = useTranslation('annotation');
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
    <BarButton
      icon={IconEye}
      label={t('review.label')}
      collapse
      tone="amber"
      active={isReviewMode}
      aria-pressed={isReviewMode}
      onClick={toggleReview}
      title={isReviewMode ? t('review.exit') : t('review.enter')}
      data-testid="review-toggle"
    />
  );
}
