import { useEffect } from 'react';
import { claimAnnotationTask, type AnnotationTaskOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { getActiveClaim, isClaimable } from '../../campaign/tasks';

export const CLAIM_RENEW_MS = 10 * 60 * 1000;

export interface ClaimTaskParams {
  campaignId: number;
  task: AnnotationTaskOut;
  currentUserId: string;
  now: number;
}

/** Requests (or renews) the claim on `task`, returning the task with whatever
 *  the server says about its holder - which may be somebody else. Contention
 *  is not an error: the badge shows who is on it and labelling stays allowed.
 *  Returns null when there was nothing to do. */
export async function claimTask(params: ClaimTaskParams): Promise<AnnotationTaskOut | null> {
  const { campaignId, task, currentUserId, now } = params;
  const claim = getActiveClaim(task, now);
  if (claim && claim.userId !== currentUserId) return null;
  // Our own claim is young enough that the renewal timer will cover it.
  if (claim && claim.heldForMs < CLAIM_RENEW_MS) return null;
  if (!claim && !isClaimable(task, now)) return null;

  const { data } = await claimAnnotationTask({
    path: { campaign_id: campaignId, annotation_task_id: task.id },
  });
  if (!data) return null;

  return {
    ...task,
    claimed_by_user_id: data.claimed ? currentUserId : (data.holder_user_id ?? null),
    claimed_at: data.claimed_at,
    claimed_by_display_name: data.claimed ? null : (data.holder_display_name ?? null),
  };
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
}

export function useClaims(options: UseClaimsOptions): void {
  const { campaignId, taskId, currentUserId, isReviewMode, getTask, onClaimed } = options;

  useEffect(() => {
    if (isReviewMode || campaignId == null || taskId == null || currentUserId == null) return;

    let cancelled = false;
    const run = async () => {
      const task = getTask();
      if (!task) return;
      // A claim is best-effort: the request can fail (offline, 500) and the
      // renewal timer must survive it, so the failure is reported once and
      // swallowed rather than escaping as an unhandled rejection.
      let updated: AnnotationTaskOut | null;
      try {
        updated = await claimTask({ campaignId, task, currentUserId, now: Date.now() });
      } catch (error) {
        if (!cancelled) handleError(error, 'Could not claim this task');
        return;
      }
      if (cancelled || !updated) return;
      onClaimed(updated);
    };
    void run();
    const renew = setInterval(() => void run(), CLAIM_RENEW_MS);
    return () => {
      cancelled = true;
      clearInterval(renew);
    };
    // Re-run only when the task/campaign identity or review mode changes -
    // getTask/onClaimed are read fresh inside `run` on every tick rather than
    // captured at effect-setup time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, taskId, currentUserId, isReviewMode]);
}
