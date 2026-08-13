import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getCampaign, listTaskSets, type CampaignOut, type TaskSetOut } from '~/api/client';
import { Skeleton, SkeletonCards } from '~/shared/ui/Skeleton';
import { Delayed } from '~/shared/ui/Delayed';
import { Button } from '~/shared/ui/forms';
import { FadeIn, MotionListItem } from '~/shared/ui/motion';
import { IconFlag, IconGear, IconMap } from '~/shared/ui/Icons';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { campaignPath } from '~/app/routes';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';

export const CampaignOverviewPage = () => {
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [taskSets, setTaskSets] = useState<TaskSetOut[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Campaign wins over the URL param, which only stands in until it loads and
  // can be wrong outright on a hand-edited /projects/<id>/campaigns/... URL.
  const projectId = campaign?.project_id ?? routeProjectId;

  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [campaignRes, taskSetsRes] = await Promise.all([
          getCampaign({ path: { campaign_id: campaignId } }),
          listTaskSets({ path: { campaign_id: campaignId } }),
        ]);
        setCampaign(campaignRes.data ?? null);
        setTaskSets(taskSetsRes.data ?? []);
        setIsAdmin(campaignRes.data?.viewer_is_admin ?? false);
      } catch (err) {
        handleError(err, 'Failed to load campaign');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [campaignId]);

  if (!loading && !campaign) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-700">Campaign not found</p>
      </div>
    );
  }

  const createdDate = campaign ? new Date(campaign.created_at).toLocaleDateString() : null;
  const totalTasks = taskSets.reduce((sum, set) => sum + set.num_tasks, 0);
  const totalLabeled = taskSets.reduce((sum, set) => sum + set.num_labeled, 0);
  const hasTasks = totalTasks > 0;

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
              <p className="page-subtitle">Created {createdDate}</p>
            ) : (
              <Skeleton className="h-4 w-32 mt-2" />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              onClick={() => navigate(campaignPath(projectId, campaignId, 'annotations'))}
            >
              Annotations
            </Button>
            {isAdmin && (
              <Button
                variant="secondary"
                leading={<IconGear className="w-4 h-4" />}
                onClick={() => navigate(campaignPath(projectId, campaignId, 'settings'))}
              >
                Settings
              </Button>
            )}
          </div>
        </header>

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
              <h2 className="text-base font-semibold text-neutral-900">Explore</h2>
              <p className="text-sm text-neutral-500 mt-0.5">
                Free-form labeling across the whole campaign area.
              </p>
            </div>
            <Button
              onClick={() =>
                navigate(`${campaignPath(projectId, campaignId, 'annotate')}?mode=explore`)
              }
              className="shrink-0"
            >
              Start exploring
            </Button>
          </div>
        </div>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-heading">Task sets</h2>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={() => navigate(campaignPath(projectId, campaignId, 'tasks'))}
              >
                Add tasks
              </Button>
            )}
          </div>
          {loading ? (
            <Delayed>
              <SkeletonCards count={3} />
            </Delayed>
          ) : !hasTasks ? (
            <div className="surface">
              <div className="surface-section text-center py-12">
                <div className="w-11 h-11 rounded-xl bg-neutral-100 flex items-center justify-center mx-auto mb-3">
                  <IconFlag className="w-5 h-5 text-neutral-400" />
                </div>
                <p className="text-sm text-neutral-800 font-medium mb-1">No tasks yet</p>
                <p className="text-sm text-neutral-500 mb-4">
                  {isAdmin
                    ? 'Set up task sets to guide annotators through specific locations.'
                    : 'An admin can add task sets for this campaign.'}
                </p>
                {isAdmin && (
                  <Button
                    variant="secondary"
                    onClick={() => navigate(campaignPath(projectId, campaignId, 'tasks'))}
                  >
                    Add tasks
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
                  onManage={
                    isAdmin
                      ? () => navigate(campaignPath(projectId, campaignId, 'tasks'))
                      : undefined
                  }
                />
              </MotionListItem>
              {taskSets.map((set, index) => (
                <MotionListItem key={set.id} index={index + 1}>
                  <TaskSetCard
                    taskSet={set}
                    onOpen={() =>
                      navigate(
                        `${campaignPath(projectId, campaignId, 'annotate')}?mode=tasks&taskSet=${set.id}`
                      )
                    }
                    onManage={
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
      </FadeIn>
    </div>
  );
};

const AllTasksCard = ({
  totalLabeled,
  totalTasks,
  onOpen,
  onManage,
}: {
  totalLabeled: number;
  totalTasks: number;
  onOpen: () => void;
  onManage?: () => void;
}) => {
  const percent = Math.round((totalLabeled / totalTasks) * 100);

  return (
    <div className="surface h-full flex flex-col border-2 border-brand-300">
      <div className="surface-section flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-900 truncate">All tasks</h3>
          {onManage && (
            <button
              type="button"
              onClick={onManage}
              className="text-[11px] text-neutral-400 hover:text-neutral-600 shrink-0"
            >
              Details
            </button>
          )}
        </div>
        <p className="text-[11px] text-brand-600 mt-0.5 font-medium">Across all sets</p>

        <div className="mt-4">
          <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mt-1.5">
            {totalLabeled} of {totalTasks} labeled
          </p>
        </div>

        <div className="mt-4 flex-1 flex items-end">
          <Button onClick={onOpen} className="w-full">
            {totalLabeled === 0 ? 'Start' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const TaskSetCard = ({
  taskSet,
  onOpen,
  onManage,
}: {
  taskSet: TaskSetOut;
  onOpen: () => void;
  onManage?: () => void;
}) => {
  const isEmpty = taskSet.num_tasks === 0;
  const percent = isEmpty ? 0 : Math.round((taskSet.num_labeled / taskSet.num_tasks) * 100);
  const createdDate = new Date(taskSet.created_at).toLocaleDateString();

  return (
    <div className="surface h-full flex flex-col">
      <div className="surface-section flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-900 truncate">{taskSet.name}</h3>
          {onManage && (
            <button
              type="button"
              onClick={onManage}
              className="text-[11px] text-neutral-400 hover:text-neutral-600 shrink-0"
            >
              Details
            </button>
          )}
        </div>
        <p className="text-[11px] text-neutral-500 mt-0.5">Created {createdDate}</p>

        <div className="mt-4">
          <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mt-1.5">
            {isEmpty ? 'No tasks yet' : `${taskSet.num_labeled} of ${taskSet.num_tasks} labeled`}
          </p>
        </div>

        <div className="mt-4 flex-1 flex items-end">
          <Button variant="secondary" onClick={onOpen} className="w-full" disabled={isEmpty}>
            {isEmpty ? 'No tasks' : taskSet.num_labeled === 0 ? 'Start' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
};
