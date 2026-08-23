import { useCallback, useEffect, useState } from 'react';
import { listPlannedTaskSets } from './api';

export const LOCKED_TASK_SET_REASON =
  'This set is managed by an area estimation design. Adding, importing or moving tasks into it would break the inclusion probabilities the estimate depends on.';

/**
 * The sampling units of an area estimate live in one task set, and that set
 * has to stay exactly what the sampling protocol drew: every task in it carries
 * a known inclusion probability, and a task added by hand carries none. One
 * such task makes the whole estimate indefensible, so these sets are read-only
 * everywhere outside this feature.
 *
 * A campaign may run several estimates, so this is a set of ids rather than
 * one. The backend will grow a purpose column on task sets to enforce it;
 * until then the stored designs name the sets they own.
 */
export const useAreaEstimationTaskSets = (campaignId: number | null) => {
  const [taskSetIds, setTaskSetIds] = useState<ReadonlySet<number>>(new Set());

  const reload = useCallback(() => {
    if (campaignId === null) return;
    void listPlannedTaskSets(campaignId).then((ids) => setTaskSetIds(new Set(ids)));
  }, [campaignId]);

  useEffect(reload, [reload]);

  return { taskSetIds, reload };
};
