import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
// An agent working normally labels within minutes; longer than this and its run is
// probably over, which is what makes its unfinished tasks worth freeing.
const STALLED_MS = 5 * 60 * 1000;
const headerCls =
  'px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider';

const lastActive = (t: TFunction<'annotation'>, at: string | null | undefined) => {
  if (!at) return t('agents.lastActive.notYet');
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (minutes < 1) return t('agents.lastActive.justNow');
  if (minutes < 60) return t('agents.lastActive.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 24
    ? t('agents.lastActive.hours', { count: hours })
    : t('agents.lastActive.days', { count: Math.round(hours / 24) });
};

// Before its first label an agent is judged by how long ago it was registered, so one
// still drawing its first views is not called stopped.
const stalled = (agent: AgentOut) =>
  agent.remaining > 0 &&
  Date.now() - new Date(agent.last_active ?? agent.created_at).getTime() > STALLED_MS;

/** The owner's labelling agents on a campaign: their progress and control over their work. */
export const AgentsPage = () => {
  const { t } = useTranslation('annotation');
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const path = { campaign_id: campaignId };
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: listAgentsQueryKey({ path }) });

  const overviewQuery = useQuery({
    ...listAgentsOptions({ path }),
    refetchInterval: AGENTS_REFRESH_MS,
    meta: { errorMessage: t('agents.loadFailed'), showUser: false },
  });
  const agents = overviewQuery.data?.agents ?? [];
  const updateAgent = useMutation({
    ...updateAgentMutation(),
    meta: { errorMessage: t('agents.updateFailed') },
    onSuccess: refresh,
  });
  const [releaseTarget, setReleaseTarget] = useState<AgentOut | 'all' | null>(null);
  const release = useMutation({
    ...releaseAgentTasksMutation(),
    meta: { errorMessage: t('agents.releaseFailed') },
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
    t('agents.breadcrumb')
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{t('agents.title')}</h1>
            <p className="text-sm text-neutral-600">{t('agents.subtitle')}</p>
          </div>
          {agents.some((agent) => agent.remaining > 0) && (
            <Button variant="dangerQuiet" size="sm" onClick={() => setReleaseTarget('all')}>
              {t('agents.freeAll')}
            </Button>
          )}
        </header>

        {overviewQuery.isLoading ? (
          <SkeletonRows count={3} />
        ) : overviewQuery.isError ? (
          <p className="text-sm text-red-600">{t('agents.loadError')}</p>
        ) : agents.length === 0 ? (
          <div className="text-center py-10 text-sm text-neutral-500">{t('agents.empty')}</div>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 rounded-xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50/50 border-b border-neutral-200">
                <tr>
                  <th className={headerCls}>{t('agents.columns.agent')}</th>
                  <th className={headerCls}>{t('agents.columns.progress')}</th>
                  <th className={headerCls} title={t('agents.columns.lastActiveHint')}>
                    {t('agents.columns.lastActive')}
                  </th>
                  <th className={headerCls} title={t('agents.columns.takesOverHint')}>
                    {t('agents.columns.takesOver')}
                  </th>
                  <th className={`${headerCls} text-right`}>{t('agents.columns.actions')}</th>
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
                            {t('agents.progress', { done, total: agent.assigned })}
                          </span>
                        </div>
                      </td>
                      <td
                        className={`px-4 py-3 text-xs ${
                          stalled(agent) ? 'text-amber-700' : 'text-neutral-600'
                        }`}
                        title={
                          agent.last_active
                            ? new Date(agent.last_active).toLocaleString()
                            : t('agents.noLabelsYet')
                        }
                      >
                        {lastActive(t, agent.last_active)}
                        {stalled(agent) && (
                          <span className="text-neutral-400"> {t('agents.stopped')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={agent.takes_over_work}
                          disabled={updateAgent.isPending}
                          aria-label={t('agents.takesOverAria', { name: agent.name })}
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
                            {t('agents.freeUnfinished', { count: agent.remaining })}
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

        <HowAgentsWork campaignName={summary?.name} />
      </div>
      <ConfirmDialog
        isOpen={releaseTarget !== null}
        title={
          releaseTarget === 'all'
            ? t('agents.release.titleAll')
            : t('agents.release.title', { name: releaseTarget?.name })
        }
        description={
          overviewQuery.data?.tasks_from === 'own_assignments'
            ? t('agents.release.toYou')
            : t('agents.release.toPool')
        }
        confirmText={t('agents.release.confirm')}
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

const Snippet = ({ tool, lines }: { tool: string; lines: string[] }) => (
  <div>
    <p className="text-[11px] font-medium text-neutral-600">{tool}</p>
    <pre className="mt-1 overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-700">
      {lines.join('\n')}
    </pre>
  </div>
);

const HowAgentsWork = ({ campaignName }: { campaignName?: string }) => {
  const { t } = useTranslation('annotation');
  return (
    <section className="mt-8 max-w-3xl space-y-4 text-[13px] leading-relaxed text-neutral-600">
      <h2 className="section-heading">{t('agents.howTo.title')}</h2>
      <p>{t('agents.howTo.intro')}</p>
      <p>
        <Trans
          t={t}
          i18nKey="agents.howTo.install"
          components={{
            link: (
              <a
                href="https://docs.astral.sh/uv/"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800"
              />
            ),
          }}
        />
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Snippet
          tool="Claude Code"
          lines={[
            '/plugin marketplace add RAAPID-ORG/stacnotator',
            '/plugin install stacnotator@stacnotator',
          ]}
        />
        <Snippet
          tool="Codex"
          lines={[
            'codex plugin marketplace add RAAPID-ORG/stacnotator',
            'codex plugin add stacnotator@stacnotator',
          ]}
        />
      </div>
      <p>{t('agents.howTo.ask')}</p>
      <pre className="overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-700">
        {t('agents.howTo.prompt', {
          campaign: campaignName ?? t('agents.howTo.exampleCampaign'),
          origin: window.location.origin,
        })}
      </pre>
      <p>{t('agents.howTo.run')}</p>
      <p>{t('agents.howTo.roles')}</p>
    </section>
  );
};
