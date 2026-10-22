import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { createTaskSet, type TaskSetOut } from '~/api/client';
import { getAnnotationFacetsOptions, listAgentsOptions } from '~/api/queries';
import { useQuery } from '@tanstack/react-query';
import { isRegistering, useCampaignSummary, useCampaignTaskSets } from '../hooks/campaignQueries';
import { Skeleton, SkeletonCards } from '~/shared/ui/Skeleton';
import { Button, Field, Input } from '~/shared/ui/forms';
import { Modal } from '~/shared/ui/Modal';
import { FadeIn, MotionListItem } from '~/shared/ui/motion';
import { IconChart, IconFlag, IconGear, IconMap } from '~/shared/ui/Icons';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { isAudienceMember } from '~/features/campaigns/utils/labellingPolicy';
import { useAccountStore } from '~/shared/stores/account.store';
import { campaignPath } from '~/app/routes';
import { InlineAddAction } from '~/shared/ui/InlineAddAction';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';
import {
  AREA_ESTIMATION_ENABLED,
  AreaEstimationPanel,
  createAreaEstimationPlan,
  useAreaEstimationTaskSets,
} from '~/features/areaEstimation/AreaEstimation';

export const CampaignOverviewPage = () => {
  const { t } = useTranslation(['campaigns', 'common']);
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const navigate = useNavigate();

  // The summary, not the full campaign: this page renders no imagery, and the full
  // read pulls sources, collections, slices and tile URLs with it.
  const { campaign, loading } = useCampaignSummary(campaignId);
  const { taskSets } = useCampaignTaskSets(campaignId);
  // Only for the count on the Annotations button, so a failure must not take the page
  // with it - it renders without the number.
  const { data: facets } = useQuery({
    ...getAnnotationFacetsOptions({ path: { campaign_id: campaignId } }),
    meta: { errorMessage: t('errors.loadAnnotationCounts'), showUser: false },
  });
  const annotationCount = facets?.total ?? null;
  // Only for the count next to the agents link, which is shown either way.
  const { data: agentsOverview } = useQuery({
    ...listAgentsOptions({ path: { campaign_id: campaignId } }),
    meta: { errorMessage: t('errors.loadAgents'), showUser: false },
  });
  const isAdmin = campaign?.viewer_is_admin ?? false;
  const currentUserId = useAccountStore((s) => s.account?.id ?? null);
  const { taskSetIds: areaEstimationSets, reload: reloadEstimates } =
    useAreaEstimationTaskSets(campaignId);
  // Naming an estimate before it exists, so the set is created with a name.
  const [namingEstimate, setNamingEstimate] = useState<string | null>(null);
  const [creatingEstimate, setCreatingEstimate] = useState(false);

  // Campaign wins over the URL param, which only stands in until it loads and
  // can be wrong outright on a hand-edited /projects/<id>/campaigns/... URL.
  const projectId = campaign?.project_id ?? routeProjectId;

  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name);

  const estimateSets = taskSets.filter((set) => areaEstimationSets.has(set.id));
  const plainSets = taskSets.filter((set) => !areaEstimationSets.has(set.id));

  const createEstimate = async () => {
    const name = (namingEstimate ?? '').trim();
    if (!name) return;
    setCreatingEstimate(true);
    try {
      const created = await createTaskSet({
        path: { campaign_id: campaignId },
        body: { name },
      });
      if (created.error || !created.data) throw created.error ?? new Error('No task set');
      await createAreaEstimationPlan(campaignId, created.data.id);
      reloadEstimates();
      setNamingEstimate(null);
      navigate(`${campaignPath(projectId, campaignId, 'tasks')}?taskSet=${created.data.id}`);
    } catch (err) {
      handleError(err, t('overview.estimate.startFailed'));
    } finally {
      setCreatingEstimate(false);
    }
  };

  if (!loading && !campaign) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-700">{t('notFound')}</p>
      </div>
    );
  }

  const createdDate = campaign ? new Date(campaign.created_at).toLocaleDateString() : null;
  const agentCount = agentsOverview?.agents.length ?? null;
  const isMember = (campaign?.viewer_is_member ?? false) || isAdmin;
  const totalTasks = taskSets.reduce((sum, set) => sum + set.num_tasks, 0);
  const totalLabeled = taskSets.reduce((sum, set) => sum + set.num_labeled, 0);
  const hasTasks = totalTasks > 0;
  const mayExplore =
    campaign != null &&
    isAudienceMember(campaign.settings.labelling_policy.explore, {
      userId: currentUserId,
      isAdmin: campaign.viewer_is_admin ?? false,
      isAuthoritative: campaign.viewer_is_authoritative_reviewer ?? false,
      isMember: campaign.viewer_is_member ?? false,
    });

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            {campaign ? (
              <h1 className="page-title">{capitalizeFirst(campaign.name)}</h1>
            ) : (
              <Skeleton className="h-7 w-52" />
            )}
            {campaign ? (
              <p className="page-subtitle">{t('overview.created', { date: createdDate })}</p>
            ) : (
              <Skeleton className="h-4 w-32 mt-2" />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              onClick={() => navigate(campaignPath(projectId, campaignId, 'annotations'))}
            >
              {t('overview.annotations')}
              {annotationCount != null && (
                <span className="ml-1.5 text-neutral-400 tabular-nums font-normal">
                  {annotationCount.toLocaleString()}
                </span>
              )}
            </Button>
            {isAdmin && (
              <Button
                variant="secondary"
                leading={<IconGear className="w-4 h-4" />}
                onClick={() => navigate(campaignPath(projectId, campaignId, 'settings'))}
              >
                {t('overview.settings')}
              </Button>
            )}
          </div>
        </header>

        {isRegistering(campaign) && (
          <div
            className="surface-section mb-6 flex items-start gap-3 border border-amber-200 bg-amber-50"
            data-testid="campaign-initializing-notice"
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 animate-pulse" />
            <div>
              <h2 className="text-sm font-semibold text-amber-900">{t('overview.setup.title')}</h2>
              <p className="mt-0.5 text-[13px] text-amber-800">
                {campaign?.registration_status === 'registering'
                  ? t('overview.setup.registering')
                  : t('overview.setup.embeddings')}{' '}
                {t('overview.setup.body')}
              </p>
            </div>
          </div>
        )}

        {mayExplore && (
          <div
            className="surface mb-6 cursor-pointer hover:bg-neutral-50 transition-colors"
            role="button"
            tabIndex={0}
            onClick={() =>
              navigate(`${campaignPath(projectId, campaignId, 'annotate')}?mode=explore`)
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                navigate(`${campaignPath(projectId, campaignId, 'annotate')}?mode=explore`);
            }}
          >
            <div className="surface-section flex items-center gap-5">
              <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                <IconMap className="w-5 h-5 text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-neutral-900">
                  {t('overview.explore.title')}
                </h2>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {t('overview.explore.description')}
                </p>
              </div>
              <Button
                onClick={() =>
                  navigate(`${campaignPath(projectId, campaignId, 'annotate')}?mode=explore`)
                }
                className="shrink-0"
              >
                {t('overview.explore.start')}
              </Button>
            </div>
          </div>
        )}

        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="section-heading">{t('overview.taskSets')}</h2>
              {isMember && (
                <button
                  type="button"
                  onClick={() => navigate(campaignPath(projectId, campaignId, 'agents'))}
                  className="text-[11px] text-neutral-500 underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-neutral-700 hover:decoration-neutral-500"
                >
                  {agentCount == null
                    ? t('overview.agents.label')
                    : agentCount === 0
                      ? t('overview.agents.none')
                      : t('overview.agents.count', { count: agentCount })}
                </button>
              )}
            </div>
            {isAdmin && (
              <InlineAddAction
                onClick={() => navigate(campaignPath(projectId, campaignId, 'tasks'))}
              >
                {t('tasksTab.addTasks')}
              </InlineAddAction>
            )}
          </div>
          {loading ? (
            <SkeletonCards count={3} />
          ) : !hasTasks ? (
            <div className="surface">
              <div className="surface-section text-center py-12">
                <div className="w-11 h-11 rounded-xl bg-neutral-100 flex items-center justify-center mx-auto mb-3">
                  <IconFlag className="w-5 h-5 text-neutral-400" />
                </div>
                <p className="text-sm text-neutral-800 font-medium mb-1">
                  {t('overview.noTasks.title')}
                </p>
                <p className="text-sm text-neutral-500 mb-4">
                  {isAdmin ? t('overview.noTasks.admin') : t('overview.noTasks.member')}
                </p>
                {isAdmin && (
                  <Button
                    variant="secondary"
                    onClick={() => navigate(campaignPath(projectId, campaignId, 'tasks'))}
                  >
                    {t('tasksTab.addTasks')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <MotionListItem index={0}>
                <AllTasksCard
                  totalLabeled={totalLabeled}
                  totalTasks={totalTasks}
                  onOpen={() =>
                    navigate(`${campaignPath(projectId, campaignId, 'annotate')}?mode=tasks`)
                  }
                  onView={() => navigate(campaignPath(projectId, campaignId, 'tasks'))}
                />
              </MotionListItem>
              {plainSets.map((set, index) => (
                <MotionListItem key={set.id} index={index + 1}>
                  <TaskSetCard
                    taskSet={set}
                    onOpen={() =>
                      navigate(
                        `${campaignPath(projectId, campaignId, 'annotate')}?mode=tasks&taskSet=${set.id}`
                      )
                    }
                    onView={() =>
                      navigate(`${campaignPath(projectId, campaignId, 'tasks')}?taskSet=${set.id}`)
                    }
                  />
                </MotionListItem>
              ))}
            </div>
          )}
        </section>

        {/* mt-8, not mb-6: this section used to sit above task sets, where its bottom
            margin did the separating. Below them it needs the space on top. */}
        {AREA_ESTIMATION_ENABLED && (estimateSets.length > 0 || isAdmin) && (
          <section className="mt-8 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-heading">{t('overview.estimate.heading')}</h2>
              {isAdmin && (
                <InlineAddAction onClick={() => setNamingEstimate('')}>
                  {t('overview.estimate.new')}
                </InlineAddAction>
              )}
            </div>
            {estimateSets.length === 0 ? (
              <div className="surface">
                <div className="surface-section text-center py-12">
                  <div className="w-11 h-11 rounded-xl bg-neutral-100 flex items-center justify-center mx-auto mb-3">
                    <IconChart className="w-5 h-5 text-neutral-400" />
                  </div>
                  <p className="text-sm text-neutral-800 font-medium mb-1">
                    {t('overview.estimate.none')}
                  </p>
                  <p className="text-sm text-neutral-500 mb-4">{t('overview.estimate.noneBody')}</p>
                  <Button variant="secondary" onClick={() => setNamingEstimate('')}>
                    {t('overview.estimate.new')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {estimateSets.map((set, index) => (
                  <MotionListItem key={set.id} index={index}>
                    <AreaEstimationPanel
                      campaignId={campaignId}
                      taskSetId={set.id}
                      taskSetName={set.name}
                      showEstimates={isAdmin}
                      onAnnotate={() =>
                        navigate(
                          `${campaignPath(projectId, campaignId, 'annotate')}?mode=tasks&taskSet=${set.id}`
                        )
                      }
                      onOpenDesign={
                        isAdmin
                          ? () =>
                              navigate(
                                `${campaignPath(projectId, campaignId, 'tasks')}?taskSet=${set.id}`
                              )
                          : undefined
                      }
                    />
                  </MotionListItem>
                ))}
              </div>
            )}
          </section>
        )}
      </FadeIn>

      {namingEstimate !== null && (
        <Modal
          title={t('overview.estimate.new')}
          onClose={() => setNamingEstimate(null)}
          maxWidth="max-w-md"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setNamingEstimate(null)}
                disabled={creatingEstimate}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => void createEstimate()}
                disabled={!namingEstimate.trim() || creatingEstimate}
                data-testid="new-area-estimate-create"
              >
                {t('common:actions.create')}
              </Button>
            </div>
          }
        >
          <div className="px-5 py-4 space-y-4">
            <p className="text-xs leading-relaxed text-neutral-600">
              {t('overview.estimate.modalBody')}
            </p>
            <Field label={t('overview.estimate.name')} hint={t('overview.estimate.nameHint')}>
              <Input
                autoFocus
                value={namingEstimate}
                onChange={(e) => setNamingEstimate(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void createEstimate()}
                placeholder={t('overview.estimate.namePlaceholder')}
                data-testid="new-area-estimate-name"
              />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
};

const AllTasksCard = ({
  totalLabeled,
  totalTasks,
  onOpen,
  onView,
}: {
  totalLabeled: number;
  totalTasks: number;
  onOpen: () => void;
  // The task list is readable by every campaign member; what it offers to do
  // with the tasks is what admin rights gate, inside the page itself.
  onView: () => void;
}) => {
  const { t } = useTranslation('campaigns');
  const percent = Math.round((totalLabeled / totalTasks) * 100);

  return (
    <div className="surface h-full flex flex-col border-2 border-brand-300">
      <div className="surface-section flex-1 flex flex-col">
        <h3 className="text-sm font-semibold text-neutral-900 truncate">
          {t('taskScope.allTasks')}
        </h3>
        <p className="text-[11px] text-brand-600 mt-0.5 font-medium">{t('overview.acrossSets')}</p>

        <div className="mt-4">
          <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mt-1.5">
            {t('overview.labeled', { labeled: totalLabeled, total: totalTasks })}
          </p>
        </div>

        <div className="mt-4 flex-1 flex items-end gap-2">
          <Button onClick={onOpen} className="flex-1">
            {t('overview.annotate')}
          </Button>
          <Button variant="secondary" onClick={onView} className="flex-1">
            {t('overview.view')}
          </Button>
        </div>
      </div>
    </div>
  );
};

const TaskSetCard = ({
  taskSet,
  onOpen,
  onView,
}: {
  taskSet: TaskSetOut;
  onOpen: () => void;
  onView: () => void;
}) => {
  const { t } = useTranslation('campaigns');
  const isEmpty = taskSet.num_tasks === 0;
  const percent = isEmpty ? 0 : Math.round((taskSet.num_labeled / taskSet.num_tasks) * 100);
  const createdDate = new Date(taskSet.created_at).toLocaleDateString();

  return (
    <div className="surface h-full flex flex-col">
      <div className="surface-section flex-1 flex flex-col">
        <h3 className="text-sm font-semibold text-neutral-900 truncate">{taskSet.name}</h3>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {t('overview.created', { date: createdDate })}
        </p>

        <div className="mt-4">
          <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mt-1.5">
            {isEmpty
              ? t('overview.noTasks.title')
              : t('overview.labeled', { labeled: taskSet.num_labeled, total: taskSet.num_tasks })}
          </p>
        </div>

        <div className="mt-4 flex-1 flex items-end gap-2">
          <Button onClick={onOpen} className="flex-1" disabled={isEmpty}>
            {isEmpty ? t('overview.noTasksShort') : t('overview.annotate')}
          </Button>
          <Button variant="secondary" onClick={onView} className="flex-1">
            {t('overview.view')}
          </Button>
        </div>
      </div>
    </div>
  );
};
