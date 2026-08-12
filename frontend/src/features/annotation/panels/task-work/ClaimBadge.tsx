import type { AnnotationTaskOut } from '~/api/client';
import { claimedByLabel } from '~/features/annotation/core/tasks';

export interface ClaimBadgeProps {
  task: AnnotationTaskOut;
  currentUserId: string | null | undefined;
  now: number;
}

export function ClaimBadge({ task, currentUserId, now }: ClaimBadgeProps) {
  const label = claimedByLabel(task, currentUserId, now);
  if (!label) return null;

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 text-[10px] font-medium border border-neutral-200">
      {label}
    </span>
  );
}
