import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { getCampaign, type CampaignOut } from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { TaskModeReview } from '../components/review/TaskModeReview';
import { OpenModeReview } from '../components/review/OpenModeReview';

export const ReviewPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const numericCampaignId = Number(campaignId);

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [loading, setLoading] = useState(true);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

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
    if (!campaignId || Number.isNaN(numericCampaignId)) return;
    const load = async () => {
      try {
        setLoading(true);
        const campaignRes = await getCampaign({ path: { campaign_id: numericCampaignId } });
        setCampaign(campaignRes.data!);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load campaign';
        showAlert(message, 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [campaignId, numericCampaignId, showAlert]);

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
    return <OpenModeReview campaign={campaign} campaignId={numericCampaignId} />;
  }

  return <TaskModeReview campaign={campaign} campaignId={numericCampaignId} />;
};
