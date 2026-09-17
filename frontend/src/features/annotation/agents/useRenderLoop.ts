import { useEffect, useMemo, useRef, useState } from 'react';
import { claimAgentRenderJob, completeAgentRenderJob, type CampaignOutFull } from '~/api/client';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { buildImageryCatalog } from '../campaign/imagery';
import { renderView } from './render';

/** Jobs drawn at once. Most of a job is waiting on tiles, so two overlap well without
 *  two pages fighting over one main thread. */
const WORKERS = 2;
const IDLE_POLL_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RenderLoopOptions {
  campaign: CampaignOutFull | undefined;
  enabled: boolean;
  /** Claimed first; other agents of the same owner are helped when it has nothing. */
  preferAgentId?: string;
}

/**
 * Claims render jobs for the owner's agents on a campaign, draws them and uploads the
 * result. Mount `stageRef` on an element that is laid out but off screen: the maps are
 * drawn there.
 */
export function useRenderLoop({ campaign, enabled, preferAgentId }: RenderLoopOptions) {
  const catalog = useMemo(() => (campaign ? buildImageryCatalog(campaign) : null), [campaign]);
  const stageRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !campaign || !catalog || !stageRef.current) return;
    const stage = stageRef.current;
    let stopped = false;

    const renderNext = async () => {
      const { data: job } = await claimAgentRenderJob({
        path: { campaign_id: campaign.id },
        query: preferAgentId ? { agent_id: preferAgentId } : undefined,
      });
      if (!job) return sleep(IDLE_POLL_MS);
      const result = await renderView({ job, campaign, catalog, stage }).catch((err) => ({
        error: extractErrorMessage(err, 'Rendering failed'),
      }));
      await completeAgentRenderJob({ path: { job_id: job.job_id }, body: result });
      setRendered((n) => n + 1);
      setLastError(result.error ?? null);
    };
    const work = async () => {
      while (!stopped) {
        // A failed poll or upload is retried; a job left claimed goes back to the
        // queue when its lease runs out.
        await renderNext().catch((err) => {
          setLastError(extractErrorMessage(err, 'Render loop failed'));
          return sleep(IDLE_POLL_MS);
        });
      }
    };
    for (let i = 0; i < WORKERS; i++) void work();
    return () => {
      stopped = true;
    };
  }, [enabled, campaign, catalog, preferAgentId]);

  return { stageRef, rendered, lastError };
}
