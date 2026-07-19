import { Fragment, useEffect, useState } from 'react';
import { SkeletonPage, SkeletonRows } from '~/shared/ui/Skeleton';
import { getCampaign, listAllCampaigns, type CampaignOut } from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { IconChevronDown, IconChevronRight } from '~/shared/ui/Icons';
import { OpenModeReview } from '../components/review/OpenModeReview';
import { ImportFeaturesSection } from '../components/settings/ImportFeaturesSection';
import { useCampaignIdParam } from '../hooks/useCampaignIdParam';

export const ReviewPage = () => {
  const campaignId = useCampaignIdParam();

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaignId}` },
        { label: 'Annotations' },
      ]);
    }
  }, [campaign, campaignId, setBreadcrumbs]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [campaignRes, campaignsListRes] = await Promise.all([
          getCampaign({ path: { campaign_id: campaignId } }),
          listAllCampaigns(),
        ]);
        setCampaign(campaignRes.data!);
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
      <SkeletonPage>
        <SkeletonRows count={8} />
      </SkeletonPage>
    );
  }

  if (!campaign) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-700">Campaign not found</p>
      </div>
    );
  }

  return (
    <Fragment>
      <OpenModeReview
        campaign={campaign}
        campaignId={campaignId}
        headerActions={
          isAdmin ? (
            <button
              type="button"
              onClick={() => setShowImport((v) => !v)}
              className="flex items-center gap-1.5 px-3 h-8 rounded-full text-sm border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 transition-colors"
              aria-expanded={showImport}
            >
              {showImport ? (
                <IconChevronDown className="w-4 h-4" />
              ) : (
                <IconChevronRight className="w-4 h-4" />
              )}
              Import annotations
            </button>
          ) : undefined
        }
        subHeader={
          isAdmin && showImport ? (
            <div className="surface mb-6">
              <div className="surface-section">
                <ImportFeaturesSection
                  campaignId={campaignId}
                  labels={campaign.settings.labels}
                  onSuccess={(msg) => showAlert(msg, 'success')}
                  onError={(msg) => showAlert(msg, 'error')}
                />
              </div>
            </div>
          ) : undefined
        }
      />
    </Fragment>
  );
};
