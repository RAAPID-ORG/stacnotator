import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  claimAgentRenderJob,
  completeAgentRenderJob,
  type AgentOut,
  type CampaignOutFull,
} from '~/api/client';
import {
  getCampaignWithImageryWindowsOptions,
  listAgentsOptions,
  listAgentsQueryKey,
  releaseAgentTasksMutation,
  releaseAllAgentTasksMutation,
  updateAgentMutation,
} from '~/api/queries';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { Button } from '~/shared/ui/forms';
import { SkeletonRows } from '~/shared/ui/Skeleton';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { buildImageryCatalog, type ImageryCatalog } from './campaign/imagery';
import { renderView } from './agents/render';

const WORKERS = 2;
const IDLE_POLL_MS = 1000;
const AGENTS_REFRESH_MS = 5000;

interface LastRender {
  agentName: string;
  taskId: number;
  src: string | null;
  error: string | null;
  ms: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The browser side of agentic labelling: while this page is open it draws the views the
 * owner's agents ask for, from the same tiles and layers the annotation page uses.
 */
export const AgentHostPage = () => {
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const path = { campaign_id: campaignId };

  const campaignQuery = useQuery({
    ...getCampaignWithImageryWindowsOptions({ path }),
    meta: { errorMessage: 'Failed to load campaign', showUser: false },
  });
  const campaign = campaignQuery.data;
  const agentsQuery = useQuery({
    ...listAgentsOptions({ path }),
    refetchInterval: AGENTS_REFRESH_MS,
    meta: { errorMessage: 'Failed to load agents', showUser: false },
  });
  const agents = agentsQuery.data ?? [];
  const queryClient = useQueryClient();
  const updateAgent = useMutation({
    ...updateAgentMutation(),
    meta: { errorMessage: 'Failed to update agent' },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listAgentsQueryKey({ path }) }),
  });
  const [releaseTarget, setReleaseTarget] = useState<AgentOut | 'all' | null>(null);
  const afterRelease = () => {
    setReleaseTarget(null);
    return queryClient.invalidateQueries({ queryKey: listAgentsQueryKey({ path }) });
  };
  const releaseOne = useMutation({
    ...releaseAgentTasksMutation(),
    meta: { errorMessage: 'Failed to free the agent tasks' },
    onSuccess: afterRelease,
  });
  const releaseAll = useMutation({
    ...releaseAllAgentTasksMutation(),
    meta: { errorMessage: 'Failed to free the agent tasks' },
    onSuccess: afterRelease,
  });
  const confirmRelease = () => {
    if (releaseTarget === 'all') releaseAll.mutate({ path });
    else if (releaseTarget) releaseOne.mutate({ path: { agent_id: releaseTarget.agent_id } });
  };

  useCampaignBreadcrumbs(
    campaign?.project_id ?? routeProjectId,
    campaignId,
    campaign?.name,
    'Agents'
  );

  const catalog = useMemo(() => (campaign ? buildImageryCatalog(campaign) : null), [campaign]);
  const [running, setRunning] = useState(true);
  const [rendered, setRendered] = useState(0);
  const [last, setLast] = useState<LastRender | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const agentNames = useRef(new Map<string, string>());
  agentNames.current = new Map(agents.map((a) => [a.agent_id, a.name]));

  useEffect(() => {
    if (!running || !campaign || !catalog || !stageRef.current) return;
    const stage = stageRef.current;
    let stopped = false;

    const renderNext = async () => {
      const { data: job } = await claimAgentRenderJob({ path: { campaign_id: campaignId } });
      if (!job) return sleep(IDLE_POLL_MS);
      const started = performance.now();
      const result = await render(job, campaign, catalog, stage);
      await completeAgentRenderJob({ path: { job_id: job.job_id }, body: result });
      setRendered((n) => n + 1);
      setLast({
        agentName: agentNames.current.get(job.agent_id) ?? job.agent_id,
        taskId: job.task.task_id,
        src: result.image_base64 ? `data:${result.mime_type};base64,${result.image_base64}` : null,
        error: result.error ?? null,
        ms: Math.round(performance.now() - started),
      });
    };
    const work = async () => {
      while (!stopped) {
        // A failed poll or upload is retried; a job left claimed goes back to the
        // queue when its lease runs out.
        await renderNext().catch(() => sleep(IDLE_POLL_MS));
      }
    };
    for (let i = 0; i < WORKERS; i++) void work();
    return () => {
      stopped = true;
    };
  }, [running, campaign, catalog, campaignId]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Labelling agents</h1>
            <p className="text-sm text-neutral-600">
              Keep this page open while your agents work: it draws the imagery they request.
              Rendering is slower when the tab is in the background.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause rendering' : 'Resume rendering'}
          </Button>
        </header>

        <section className="surface mb-6">
          <div className="surface-section">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm" data-testid="agent-host-status">
                {running ? 'Rendering' : 'Paused'} - {rendered} views drawn
              </p>
              {agents.some((agent) => agent.remaining > 0) && (
                <Button variant="secondary" size="sm" onClick={() => setReleaseTarget('all')}>
                  Free all agent tasks
                </Button>
              )}
            </div>
            {agentsQuery.isLoading ? (
              <SkeletonRows count={3} />
            ) : agents.length === 0 ? (
              <p className="text-sm text-neutral-600 mt-2">
                No agents yet. Register one with the stacnotator MCP server.
              </p>
            ) : (
              <table className="w-full text-sm mt-3">
                <thead className="text-left text-neutral-600">
                  <tr>
                    <th>Agent</th>
                    <th>Description</th>
                    <th>Done</th>
                    <th>Remaining</th>
                    <th title="When this agent runs out of tasks, it takes over tasks still waiting on your other agents">
                      Takes over work
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.agent_id}>
                      <td className="font-medium">{agent.name}</td>
                      <td className="text-neutral-600">{agent.description}</td>
                      <td>{agent.assigned - agent.remaining}</td>
                      <td>{agent.remaining}</td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${agent.name} takes over other agents' work`}
                          checked={agent.takes_over_work}
                          disabled={updateAgent.isPending}
                          onChange={(event) =>
                            updateAgent.mutate({
                              path: { agent_id: agent.agent_id },
                              body: { takes_over_work: event.target.checked },
                            })
                          }
                        />
                      </td>
                      <td className="text-right">
                        {agent.remaining > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setReleaseTarget(agent)}
                          >
                            Free tasks
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {last && (
          <section className="surface">
            <div className="surface-section">
              <p className="text-sm mb-2">
                Last view: {last.agentName}, task {last.taskId}, {last.ms} ms
              </p>
              {last.error && <p className="text-sm text-red-700">{last.error}</p>}
              {last.src && (
                <img src={last.src} alt="Last rendered agent view" className="max-w-full" />
              )}
            </div>
          </section>
        )}
      </div>
      <div ref={stageRef} aria-hidden className="fixed -left-[10000px] top-0" />
      <ConfirmDialog
        isOpen={releaseTarget !== null}
        title={
          releaseTarget === 'all'
            ? 'Free the unfinished tasks of all your agents?'
            : `Free the unfinished tasks of ${releaseTarget?.name}?`
        }
        description="They go back to the campaign's open pool. Tasks already labelled or skipped stay as they are."
        confirmText="Free tasks"
        isDangerous
        isLoading={releaseOne.isPending || releaseAll.isPending}
        onConfirm={confirmRelease}
        onCancel={() => setReleaseTarget(null)}
      />
    </div>
  );
};

async function render(
  job: Parameters<typeof renderView>[0]['job'],
  campaign: CampaignOutFull,
  catalog: ImageryCatalog,
  stage: HTMLElement
) {
  try {
    return await renderView({ job, campaign, catalog, stage });
  } catch (err) {
    return { error: extractErrorMessage(err, 'Rendering failed') };
  }
}
