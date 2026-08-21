import { useEffect, useState } from 'react';
import { loadPlan } from './api';

/**
 * The task set the area estimation design owns, or null when the campaign has
 * no design. Callers use it to keep hands off that set.
 */
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
