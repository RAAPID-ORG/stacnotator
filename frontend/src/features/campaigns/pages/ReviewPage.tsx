import { Fragment, useEffect, useState } from 'react';
import { Skeleton, SkeletonRows } from '~/shared/ui/Skeleton';
import { Delayed } from '~/shared/ui/Delayed';
import { getCampaignSummary, type CampaignSummaryOut } from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { IconUploadFilled } from '~/shared/ui/Icons';
import { Button } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { OpenModeReview } from '../components/review/OpenModeReview';
import { ImportFeaturesSection } from '../components/settings/ImportFeaturesSection';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';

export const ReviewPage = () => {
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();

  const [campaign, setCampaign] = useState<CampaignSummaryOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);

  // Campaign wins over the URL param, which only stands in until it loads and
  // can be wrong outright on a hand-edited /projects/<id>/campaigns/... URL.
  const projectId = campaign?.project_id ?? routeProjectId;
  const showAlert = useLayoutStore((state) => state.showAlert);

  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name, 'Annotations');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const campaignRes = await getCampaignSummary({ path: { campaign_id: campaignId } });
        setCampaign(campaignRes.data!);
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

  const isAdmin = campaign?.viewer_is_admin ?? false;

  return (
    <Fragment>
      {campaign ? (
        <OpenModeReview
          campaign={campaign}
          campaignId={campaignId}
          headerActions={
            isAdmin ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowImport((v) => !v)}
                aria-expanded={showImport}
                leading={<IconUploadFilled className="w-4 h-4" />}
              >
                Import annotations
              </Button>
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
      ) : (
        <div className="flex-1 overflow-auto">
          <FadeIn className="page">
            <header className="page-header">
              <div>
                <Skeleton className="h-7 w-52" />
              </div>
            </header>
            <Delayed>
              <SkeletonRows count={8} />
            </Delayed>
          </FadeIn>
        </div>
      )}
    </Fragment>
  );
};
