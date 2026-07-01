import { useEffect, useState } from 'react';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { getCampaign, type CampaignOut } from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { TaskModeReview } from '../components/review/TaskModeReview';
import { OpenModeReview } from '../components/review/OpenModeReview';
import { useCampaignIdParam } from '../hooks/useCampaignIdParam';

export const ReviewPage = () => {
  const campaignId = useCampaignIdParam();

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [loading, setLoading] = useState(true);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaignId}/annotate` },
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

  if (campaign.mode === 'open') {
    return <OpenModeReview campaign={campaign} campaignId={campaignId} />;
  }

  return <TaskModeReview campaign={campaign} campaignId={campaignId} />;
};
