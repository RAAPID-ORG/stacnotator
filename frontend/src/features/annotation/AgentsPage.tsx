import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentOut } from '~/api/client';
import {
  listAgentsOptions,
  listAgentsQueryKey,
  releaseAgentTasksMutation,
  updateAgentMutation,
} from '~/api/queries';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';
import { useCampaignSummary } from '~/features/campaigns/hooks/campaignQueries';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { Button, Switch } from '~/shared/ui/forms';
import { SkeletonRows } from '~/shared/ui/Skeleton';

const AGENTS_REFRESH_MS = 5000;
const headerCls =
  'px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider';

/** The owner's labelling agents on a campaign: their progress and control over their work. */
export const AgentsPage = () => {
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const path = { campaign_id: campaignId };
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: listAgentsQueryKey({ path }) });

  const overviewQuery = useQuery({
    ...listAgentsOptions({ path }),
    refetchInterval: AGENTS_REFRESH_MS,
    meta: { errorMessage: 'Failed to load agents', showUser: false },
  });
  const agents = overviewQuery.data?.agents ?? [];
  const updateAgent = useMutation({
    ...updateAgentMutation(),
    meta: { errorMessage: 'Failed to update agent' },
    onSuccess: refresh,
  });
  const [releaseTarget, setReleaseTarget] = useState<AgentOut | 'all' | null>(null);
  const release = useMutation({
    ...releaseAgentTasksMutation(),
    meta: { errorMessage: 'Failed to free the agent tasks' },
    onSuccess: () => {
      setReleaseTarget(null);
      return refresh();
    },
  });

  const { campaign: summary } = useCampaignSummary(campaignId);
  useCampaignBreadcrumbs(
    summary?.project_id ?? routeProjectId,
    campaignId,
    summary?.name,
    'Agents'
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Labelling agents</h1>
            <p className="text-sm text-neutral-600">
              Agents registered through the stacnotator MCP server, and their progress.
            </p>
          </div>
          {agents.some((agent) => agent.remaining > 0) && (
            <Button variant="dangerQuiet" size="sm" onClick={() => setReleaseTarget('all')}>
              Free all unfinished tasks
            </Button>
          )}
        </header>

        {overviewQuery.isLoading ? (
          <SkeletonRows count={3} />
        ) : overviewQuery.isError ? (
          <p className="text-sm text-red-600">Could not load the agents.</p>
        ) : agents.length === 0 ? (
          <div className="text-center py-10 text-sm text-neutral-500">No agents yet.</div>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50/50 border-b border-neutral-200">
                <tr>
                  <th className={headerCls}>Agent</th>
                  <th className={headerCls}>Progress</th>
                  <th
                    className={headerCls}
                    title="When this agent runs out of tasks, it takes over tasks still waiting on your other agents"
                  >
                    Takes over work
                  </th>
                  <th className={`${headerCls} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {agents.map((agent) => {
                  const done = agent.assigned - agent.remaining;
                  return (
                    <tr key={agent.agent_id} className="hover:bg-neutral-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-900">{agent.name}</div>
                        {agent.description && (
                          <div className="text-xs text-neutral-500">{agent.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 w-28 rounded-full bg-neutral-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-brand-600 transition-[width]"
                              style={{
                                width: `${agent.assigned ? (100 * done) / agent.assigned : 0}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-neutral-600 tabular-nums">
                            {done} of {agent.assigned}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={agent.takes_over_work}
                          disabled={updateAgent.isPending}
                          aria-label={`${agent.name} takes over other agents' work`}
                          onChange={(checked) =>
                            updateAgent.mutate({
                              path: { agent_id: agent.agent_id },
                              body: { takes_over_work: checked },
                            })
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {agent.remaining > 0 && (
                          <button
                            type="button"
                            onClick={() => setReleaseTarget(agent)}
                            className="inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors text-red-600 hover:bg-red-50"
                          >
                            Free {agent.remaining} unfinished
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
        isLoading={release.isPending}
        onConfirm={() => {
          release.mutate({
            path,
            query: releaseTarget === 'all' ? undefined : { agent_id: releaseTarget?.agent_id },
          });
        }}
        onCancel={() => setReleaseTarget(null)}
      />
    </div>
  );
};
