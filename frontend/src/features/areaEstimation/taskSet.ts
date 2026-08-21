import { useEffect, useState } from 'react';
import { loadPlan } from './api';

/**
 * The sample points live in one task set that belongs to the design.
 *
 * The set has to stay exactly what the sampling protocol drew: every task in
 * it carries a known inclusion probability, and a task added by hand carries
 * none. One such task makes the whole estimate indefensible, so the set is
 * read-only everywhere outside this feature.
 *
 * The backend will grow a purpose column on task sets to enforce this; until
 * then the plan names the set it owns and the UI locks that one.
 */

export const AREA_ESTIMATION_TASK_SET_NAME = 'Area estimation sample';

export const LOCKED_TASK_SET_REASON =
  'This set is managed by the area estimation design. Adding, importing or moving tasks into it would break the sampling probabilities the estimate depends on.';

/** The locked set's id, or null when the campaign has no design. */
export const useAreaEstimationTaskSet = (campaignId: number | null): number | null => {
  const [taskSetId, setTaskSetId] = useState<number | null>(null);

  useEffect(() => {
    if (campaignId === null) return;
    let cancelled = false;
    void loadPlan(campaignId).then((plan) => {
      if (!cancelled) setTaskSetId(plan?.taskSetId ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  return taskSetId;
};
