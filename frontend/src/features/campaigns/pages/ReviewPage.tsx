import { Fragment, useEffect, useState } from 'react';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { getCampaign, listAllCampaigns, type CampaignOut } from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { IconChevronDown, IconChevronRight } from '~/shared/ui/Icons';
import { TaskModeReview } from '../components/review/TaskModeReview';
import { OpenModeReview } from '../components/review/OpenModeReview';
import { ImportFeaturesSection } from '../components/settings/ImportFeaturesSection';
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<ReviewScope | null>(null);
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

  // All annotations is the unified view across task and explore work, so it's
  // always the default; the per-task lens is opt-in via the toggle.
  const effectiveScope: ReviewScope = scope ?? 'all';

  return (
    <Fragment>
      <div className="w-full max-w-[80rem] mx-auto px-6 pt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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

        {isAdmin && (
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
        )}
      </div>

      {isAdmin && showImport && (
        <div className="w-full max-w-[80rem] mx-auto px-6 pt-3">
          <div className="surface">
            <div className="surface-section">
              <ImportFeaturesSection
                campaignId={campaignId}
                labels={campaign.settings.labels}
                onSuccess={(msg) => showAlert(msg, 'success')}
                onError={(msg) => showAlert(msg, 'error')}
              />
            </div>
          </div>
        </div>
      )}

      {effectiveScope === 'all' ? (
        <OpenModeReview campaign={campaign} campaignId={campaignId} />
      ) : (
        <TaskModeReview campaign={campaign} campaignId={campaignId} />
      )}
    </Fragment>
  );
};
