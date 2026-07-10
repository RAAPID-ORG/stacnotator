import { Fragment, useEffect, useState } from 'react';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { getCampaign, type CampaignOut } from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { TaskModeReview } from '../components/review/TaskModeReview';
import { OpenModeReview } from '../components/review/OpenModeReview';
import { useCampaignIdParam } from '../hooks/useCampaignIdParam';

type ReviewScope = 'tasks' | 'all';

const pillCls = (active: boolean) =>
  `px-3 h-8 rounded-full text-sm border transition-colors ${
    active
      ? 'bg-brand-600 text-white border-brand-600'
      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
  }`;

export const ReviewPage = () => {
  const campaignId = useCampaignIdParam();

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<ReviewScope | null>(null);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaignId}` },
        { label: 'Review' },
      ]);
    }
  }, [campaign, campaignId, setBreadcrumbs]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const campaignRes = await getCampaign({ path: { campaign_id: campaignId } });
        setCampaign(campaignRes.data!);
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
        <LoadingSpinner size="lg" text="Loading..." />
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

  const effectiveScope: ReviewScope = scope ?? (campaign.mode === 'open' ? 'all' : 'tasks');

  return (
    <Fragment>
      <div className="w-full max-w-[80rem] mx-auto px-6 pt-4 flex items-center gap-2">
        <button
          type="button"
          className={pillCls(effectiveScope === 'tasks')}
          onClick={() => setScope('tasks')}
        >
          Tasks
        </button>
        <button
          type="button"
          className={pillCls(effectiveScope === 'all')}
          onClick={() => setScope('all')}
        >
          All annotations
        </button>
      </div>

      {effectiveScope === 'all' ? (
        <OpenModeReview campaign={campaign} campaignId={campaignId} />
      ) : (
        <TaskModeReview campaign={campaign} campaignId={campaignId} />
      )}
    </Fragment>
  );
};
