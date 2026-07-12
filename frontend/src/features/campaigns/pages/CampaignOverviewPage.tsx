import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  getCampaign,
  listAllCampaigns,
  listTaskSets,
  type CampaignOut,
  type TaskSetOut,
} from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { Button } from '~/shared/ui/forms';
import { FadeIn, MotionListItem } from '~/shared/ui/motion';
import { IconFlag, IconGear, IconMap } from '~/shared/ui/Icons';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { useCampaignIdParam } from '../hooks/useCampaignIdParam';

export const CampaignOverviewPage = () => {
  const campaignId = useCampaignIdParam();
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [taskSets, setTaskSets] = useState<TaskSetOut[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name) },
      ]);
    }
  }, [campaign, setBreadcrumbs]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [campaignRes, taskSetsRes, campaignsListRes] = await Promise.all([
          getCampaign({ path: { campaign_id: campaignId } }),
          listTaskSets({ path: { campaign_id: campaignId } }),
          listAllCampaigns(),
        ]);
        setCampaign(campaignRes.data ?? null);
        setTaskSets(taskSetsRes.data ?? []);
        // CampaignOut has no is_admin flag; the campaigns list endpoint does,
        // so we cross-reference it here rather than adding a backend field.
        const listEntry = campaignsListRes.data?.items.find((c) => c.id === campaignId);
        setIsAdmin(listEntry?.is_admin ?? false);
      } catch (err) {
        handleError(err, 'Failed to load campaign');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [campaignId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading campaign..." />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-700">Campaign not found</p>
      </div>
    );
  }

  const createdDate = new Date(campaign.created_at).toLocaleDateString();

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{capitalizeFirst(campaign.name)}</h1>
            <p className="page-subtitle">Created {createdDate}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              onClick={() => navigate(`/campaigns/${campaignId}/annotations`)}
            >
              Review
            </Button>
            {isAdmin && (
              <Button
                variant="secondary"
                leading={<IconGear className="w-4 h-4" />}
                onClick={() => navigate(`/campaigns/${campaignId}/settings`)}
              >
                Settings
              </Button>
            )}
          </div>
        </header>

        <div className="surface mb-6">
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
              onClick={() => navigate(`/campaigns/${campaignId}/annotate?mode=explore`)}
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
                onClick={() => navigate(`/campaigns/${campaignId}/tasks`)}
              >
                Add tasks
              </Button>
            )}
          </div>
          {taskSets.length === 0 ? (
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
                    onClick={() => navigate(`/campaigns/${campaignId}/tasks`)}
                  >
                    Add tasks
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {taskSets.map((set, index) => (
                <MotionListItem key={set.id} index={index}>
                  <TaskSetCard
                    taskSet={set}
                    onOpen={() =>
                      navigate(`/campaigns/${campaignId}/annotate?mode=tasks&taskSet=${set.id}`)
                    }
                    onManage={
                      isAdmin
                        ? () => navigate(`/campaigns/${campaignId}/tasks?taskSet=${set.id}`)
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
              Manage
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
