import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AgentOut, type RecentViewOut } from '~/api/client';
import {
  getAgentRenderJobImageOptions,
  getCampaignWithImageryWindowsOptions,
  listAgentsOptions,
  listAgentsQueryKey,
  listRecentAgentViewsOptions,
  releaseAgentTasksMutation,
  releaseAllAgentTasksMutation,
  updateAgentMutation,
} from '~/api/queries';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';
import { useCampaignSummary } from '~/features/campaigns/hooks/campaignQueries';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { Button } from '~/shared/ui/forms';
import { SkeletonRows } from '~/shared/ui/Skeleton';
import { useRenderLoop } from './agents/useRenderLoop';

const AGENTS_REFRESH_MS = 5000;
const VIEWS_REFRESH_MS = 3000;
/** Longer than a render page's poll interval, with room for a slow claim. */
const RENDERER_STALE_MS = 20_000;

/**
 * Where the owner watches their agents: what each one was just shown, its progress, and
 * the controls over its work. The views are drawn by headless render pages the SDK starts;
 * this tab only draws them itself when asked to, for machines without those.
 */
export const AgentHostPage = () => {
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const path = { campaign_id: campaignId };

  const [renderHere, setRenderHere] = useState(false);
  // The full campaign is only needed to draw; watching needs none of it.
  const campaignQuery = useQuery({
    ...getCampaignWithImageryWindowsOptions({ path }),
    enabled: renderHere,
    meta: { errorMessage: 'Failed to load campaign', showUser: false },
  });
  const { stageRef, rendered, lastError } = useRenderLoop({
    campaign: campaignQuery.data,
    enabled: renderHere,
  });
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

  const recentViews = useQuery({
    ...listRecentAgentViewsOptions({ path }),
    refetchInterval: VIEWS_REFRESH_MS,
    meta: { errorMessage: 'Failed to load agent views', showUser: false },
  }).data;

  const { campaign: summary } = useCampaignSummary(campaignId);
  useCampaignBreadcrumbs(
    summary?.project_id ?? routeProjectId,
    campaignId,
    summary?.name,
    'Agents'
  );

  const lastPoll = Math.max(0, ...agents.map((a) => Date.parse(a.host_seen_at ?? '') || 0));
  const renderersAlive = Date.now() - lastPoll < RENDERER_STALE_MS;

  return (
    <div className="flex-1 overflow-auto">
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Labelling agents</h1>
            <p className="text-sm text-neutral-600">
              What your agents are looking at, as they work.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={renderHere}
              onChange={(event) => setRenderHere(event.target.checked)}
            />
            Render in this tab
          </label>
        </header>

        <section className="surface mb-6">
          <div className="surface-section">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm" data-testid="agent-host-status">
                {renderersAlive
                  ? 'Render browsers are running'
                  : agents.some((agent) => agent.remaining > 0)
                    ? 'No render browser is running: let the MCP server start them, or render in this tab'
                    : 'Idle'}
                {renderHere && ` - ${rendered} views drawn here`}
                {renderHere && lastError && ` - ${lastError}`}
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

        <RecentViews agents={agents} views={recentViews ?? []} />
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

function RecentViews({ agents, views }: { agents: AgentOut[]; views: RecentViewOut[] }) {
  if (views.length === 0) return null;
  return (
    <>
      {agents.map((agent) => {
        const own = views.filter((view) => view.agent_id === agent.agent_id);
        if (own.length === 0) return null;
        return (
          <section key={agent.agent_id} className="surface mb-6">
            <div className="surface-section">
              <p className="text-sm font-medium mb-2">
                {agent.name} - task {own[0].task_id}
              </p>
              <div className="flex flex-wrap gap-3 items-start">
                {own.map((view) => (
                  <ViewImage key={view.job_id} view={view} />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

/** Fetched once per view: a drawn view never changes. */
function ViewImage({ view }: { view: RecentViewOut }) {
  const { data } = useQuery({
    ...getAgentRenderJobImageOptions({ path: { job_id: view.job_id }, parseAs: 'blob' }),
    staleTime: Infinity,
    meta: { errorMessage: 'Failed to load an agent view', showUser: false },
  });
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!(data instanceof Blob)) return;
    const url = URL.createObjectURL(data);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [data]);

  return (
    <figure className="max-w-full" style={{ width: Math.min(view.width ?? 640, 640) }}>
      {src && <img src={src} alt={`Agent view of task ${view.task_id}`} className="max-w-full" />}
      <figcaption className="text-xs text-neutral-600 mt-1">
        {new Date(view.delivered_at).toLocaleTimeString()} - {view.captions.length} cells
      </figcaption>
    </figure>
  );
}
