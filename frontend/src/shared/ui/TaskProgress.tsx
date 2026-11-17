import { useTranslation } from 'react-i18next';
import type { CampaignProgressOut } from '~/api/client';
import { Tooltip } from '~/shared/ui/Tooltip';

export type TaskProgressCounts = Omit<CampaignProgressOut, 'campaign_id'>;

const ALL_COLOR = 'bg-brand-600';
const MINE_COLOR = 'bg-brand-300';

const Row = ({
  ariaLabel,
  done,
  total,
  color,
  height,
}: {
  ariaLabel: string;
  done: number;
  total: number;
  color: string;
  height: string;
}) => (
  <div
    className={height}
    role="progressbar"
    aria-label={ariaLabel}
    aria-valuenow={done}
    aria-valuemin={0}
    aria-valuemax={total}
  >
    <div
      className={`h-full transition-[width] ${color}`}
      style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
    />
  </div>
);

const Count = ({ color, children }: { color?: string; children: React.ReactNode }) => (
  <span className="flex items-center gap-1">
    {color && <span className={`h-1.5 w-1.5 rounded-full ${color}`} aria-hidden="true" />}
    {children}
  </span>
);

/** One bar: tasks done across everyone, and directly beneath it in a second row the
 * viewer's own answered assignments when they have any. */
export const TaskProgress = ({
  progress,
  className = '',
  compact = false,
}: {
  progress: TaskProgressCounts;
  className?: string;
  compact?: boolean;
}) => {
  const { t } = useTranslation();
  const count = (done: number, total: number) =>
    t('taskProgress.count', { done: done.toLocaleString(), total: total.toLocaleString() });
  const hasMine = progress.num_assigned > 0;
  const all = count(progress.num_done, progress.num_tasks);
  const mine = count(progress.num_assigned_done, progress.num_assigned);
  const tooltip = [
    t('taskProgress.allTooltip', { count: all }),
    hasMine && t('taskProgress.yoursTooltip', { count: mine }),
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <Tooltip text={tooltip} className={`w-full ${className}`}>
      <div className="w-full">
        <div className="flex items-baseline justify-between gap-2 whitespace-nowrap text-[11px] leading-none text-neutral-500 tabular-nums">
          {hasMine ? (
            <Count color={MINE_COLOR}>
              <span className={compact ? 'sr-only' : undefined}>{t('taskProgress.yours')} </span>
              {mine}
            </Count>
          ) : (
            <span />
          )}
          <Count color={hasMine ? ALL_COLOR : undefined}>{all}</Count>
        </div>
        <div className="mt-1 overflow-hidden rounded-full bg-neutral-100">
          <Row
            ariaLabel={t('taskProgress.allLabel')}
            done={progress.num_done}
            total={progress.num_tasks}
            color={ALL_COLOR}
            height={hasMine ? 'h-1' : 'h-1.5'}
          />
          {hasMine && (
            <Row
              ariaLabel={t('taskProgress.yoursLabel')}
              done={progress.num_assigned_done}
              total={progress.num_assigned}
              color={MINE_COLOR}
              height="h-1"
            />
          )}
        </div>
      </div>
    </Tooltip>
  );
};
