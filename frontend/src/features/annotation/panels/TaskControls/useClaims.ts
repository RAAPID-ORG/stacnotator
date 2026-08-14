import { useEffect } from 'react';
import { claimAnnotationTask, type AnnotationTaskOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { isClaimable } from '../../campaign/tasks';

export const CLAIM_RENEW_MS = 10 * 60 * 1000;

export type ClaimStatus = 'claimed' | 'skip' | 'noop';

export interface ClaimResult {
  status: ClaimStatus;
  task?: AnnotationTaskOut;
}

export interface ClaimTaskParams {
  campaignId: number;
  task: AnnotationTaskOut;
  currentUserId: string;
  now: number;
}

/** Requests (or renews) the soft claim for `task`. No-op when the task isn't
 *  ours to claim (already labeled, or actively held by someone else).
 *  'skip' on a 409: someone else claimed it between our check and the
 *  request, so the caller should move on. */
export async function claimTask(params: ClaimTaskParams): Promise<ClaimResult> {
  const { campaignId, task, currentUserId, now } = params;
  const mine = (task.assignments || []).find((a) => a.user_id === currentUserId);
  const holdsSoftClaim = mine != null && mine.claimed_at != null && mine.status === 'pending';
  if (!holdsSoftClaim && !isClaimable(task, now)) return { status: 'noop' };

  const { data, response } = await claimAnnotationTask({
    path: { campaign_id: campaignId, annotation_task_id: task.id },
  });

  if (data) {
    const assignments = mine
      ? (task.assignments || []).map((a) =>
          a.user_id === currentUserId ? { ...a, claimed_at: data.claimed_at } : a
        )
      : [
          ...(task.assignments || []),
          { user_id: currentUserId, status: 'pending' as const, claimed_at: data.claimed_at },
        ];
    return { status: 'claimed', task: { ...task, assignments } };
  }
  if (response.status === 409) return { status: 'skip' };
  return { status: 'noop' };
}

export interface UseClaimsOptions {
  campaignId: number | null;
  taskId: number | null;
  currentUserId: string | null;
  isReviewMode: boolean;
  /** Reads live task-list state; called at claim time, not effect-setup
   *  time, so a 10-minute-later renewal claims the current task even if the
   *  list changed since this effect last (re)ran. */
  getTask: () => AnnotationTaskOut | null;
  onClaimed: (task: AnnotationTaskOut) => void;
  onSkip: () => void;
}

export function useClaims(options: UseClaimsOptions): void {
  const { campaignId, taskId, currentUserId, isReviewMode, getTask, onClaimed, onSkip } = options;

  useEffect(() => {
    if (isReviewMode || campaignId == null || taskId == null || currentUserId == null) return;

    let cancelled = false;
    const run = async () => {
      const task = getTask();
      if (!task) return;
      // A claim is best-effort: the request can fail (offline, 500) and the
      // renewal timer must survive it, so the failure is reported once and
      // swallowed rather than escaping as an unhandled rejection.
      let result: ClaimResult;
      try {
        result = await claimTask({ campaignId, task, currentUserId, now: Date.now() });
      } catch (error) {
        if (!cancelled) handleError(error, 'Could not claim this task');
        return;
      }
      if (cancelled) return;
      if (result.status === 'claimed' && result.task) onClaimed(result.task);
      else if (result.status === 'skip') onSkip();
    };
    void run();
    const renew = setInterval(() => void run(), CLAIM_RENEW_MS);
    return () => {
      cancelled = true;
      clearInterval(renew);
    };
    // Re-run only when the task/campaign identity or review mode changes -
    // getTask/onClaimed/onSkip are read fresh inside `run` on every tick
    // rather than captured at effect-setup time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, taskId, currentUserId, isReviewMode]);
}
