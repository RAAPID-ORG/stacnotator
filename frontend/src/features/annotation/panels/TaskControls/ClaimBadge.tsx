import type { AnnotationTaskOut } from '~/api/client';
import { claimedByLabel, getActiveClaim } from '../../campaign/tasks';
import { useCurrentTask } from '../../stores/tasks';
import { useCampaignStore } from '../../stores/campaign';

export interface ClaimBadgeProps {
  task: AnnotationTaskOut;
  currentUserId: string | null | undefined;
  now: number;
}

export function ClaimBadge({ task, currentUserId, now }: ClaimBadgeProps) {
  const label = claimedByLabel(task, currentUserId, now);
  if (!label) return null;

  const claimedByMe = getActiveClaim(task, now)?.user_id === currentUserId;

  return (
    <span
      title={label}
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        claimedByMe ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-600'
      }`}
    >
      {label}
    </span>
  );
}

/** The current task's claim, for the task panel's card header - the badge
 *  belongs to the task as a whole, not to any one control inside the panel. */
export function TaskClaimBadge() {
  const task = useCurrentTask();
  const currentUserId = useCampaignStore((s) => s.currentUserId);
  if (!task) return null;

  return <ClaimBadge task={task} currentUserId={currentUserId} now={Date.now()} />;
}
