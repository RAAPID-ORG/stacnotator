import { useTranslation } from 'react-i18next';
import type { CampaignProgressOut } from '~/api/client';

export type TaskProgressCounts = Omit<CampaignProgressOut, 'campaign_id'>;

const ProgressLine = ({
  label,
  ariaLabel,
  done,
  total,
  barClassName,
}: {
  label: string;
  ariaLabel: string;
  done: number;
  total: number;
  barClassName: string;
}) => {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap text-[11px] leading-none text-neutral-500 tabular-nums">
        <span>{label}</span>
        <span>
          {t('taskProgress.count', { done: done.toLocaleString(), total: total.toLocaleString() })}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          className={`h-full rounded-full transition-[width] ${barClassName}`}
          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
};

/** Tasks done across everyone, and below it the viewer's own assigned tasks they
 * answered when they have any. */
export const TaskProgress = ({
  progress,
  className = '',
}: {
  progress: TaskProgressCounts;
  className?: string;
}) => {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <ProgressLine
        label={t('taskProgress.all')}
        ariaLabel={t('taskProgress.allLabel')}
        done={progress.num_done}
        total={progress.num_tasks}
        barClassName="bg-brand-600"
      />
      {progress.num_assigned > 0 && (
        <ProgressLine
          label={t('taskProgress.yours')}
          ariaLabel={t('taskProgress.yoursLabel')}
          done={progress.num_assigned_done}
          total={progress.num_assigned}
          barClassName="bg-brand-400"
        />
      )}
    </div>
  );
};
