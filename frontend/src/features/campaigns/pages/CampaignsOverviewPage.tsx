import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { IconPlus, IconDocument, IconGear } from '~/shared/ui/Icons';
import { useLayoutStore } from '~/features/layout/layout.store';
import { listAllCampaigns, type CampaignListItemOut } from '~/api/client';
import { capitalizeFirst } from '~/shared/utils/utility';

export const CampaignsPage = () => {
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<CampaignListItemOut[]>([]);
  const [loading, setLoading] = useState(true);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Campaigns' }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        setLoading(true);
        const { data } = await listAllCampaigns();
        setCampaigns(data?.items ?? []);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load campaign';
        showAlert(message, 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchCampaigns();
  }, [showAlert]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading campaigns..." />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-neutral-900">Campaigns</h1>
        <button
          onClick={() => navigate('/campaigns/new')}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium bg-brand-500 text-white rounded-md hover:bg-brand-700 transition-colors cursor-pointer"
        >
          <IconPlus className="w-3.5 h-3.5" />
          New Campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-3">
            <IconDocument className="w-5 h-5 text-brand-500" />
          </div>
          <p className="text-base text-neutral-600 mb-1 font-medium">No campaigns yet</p>
          <p className="text-sm text-neutral-400 mb-4">
            Create your first campaign to get started.
          </p>
          <button
            onClick={() => navigate('/campaigns/new')}
            className="text-xs text-brand-600 hover:text-brand-800 font-medium cursor-pointer transition-colors"
          >
            Create campaign
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {campaigns.map((campaign) => {
            const isMember = campaign.is_member ?? false;
            const isAdmin = campaign.is_admin ?? false;
            const isPublic = campaign.is_public ?? false;
            const canAccess = isMember || isPublic;

            return (
              <div
                key={campaign.id}
                className="bg-white border border-neutral-200 rounded-lg hover:border-brand-400 hover:shadow-md transition-all overflow-hidden"
              >
                <div className="p-3.5">
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-base font-semibold text-neutral-900 truncate">
                        {capitalizeFirst(campaign.name)}
                      </h3>
                      {isPublic && (
                        <span className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">
                          Public
                        </span>
                      )}
                    </div>
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/campaigns/${campaign.id}/settings`);
                        }}
                        className="shrink-0 text-neutral-400 hover:text-brand-500 transition-colors cursor-pointer p-0.5"
                        type="button"
                        aria-label="Campaign settings"
                      >
                        <IconGear className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="border-t border-neutral-100 flex text-xs">
                  {(() => {
                    const isInitializing =
                      campaign.registration_status === 'registering' ||
                      campaign.embedding_status === 'registering';
                    const canAnnotate = canAccess && !isInitializing;
                    return (
                      <button
                        onClick={() =>
                          canAnnotate && navigate(`/campaigns/${campaign.id}/annotate`)
                        }
                        className={`flex-1 px-3 py-2 font-medium transition-colors ${
                          canAnnotate
                            ? 'text-neutral-600 hover:bg-neutral-50 hover:text-brand-600 cursor-pointer'
                            : 'text-neutral-300 cursor-not-allowed'
                        }`}
                        type="button"
                        disabled={!canAnnotate}
                        title={isInitializing ? 'Campaign is initializing...' : undefined}
                      >
                        {isInitializing ? 'Initializing...' : 'Annotate'}
                      </button>
                    );
                  })()}
                  <div className="w-px bg-neutral-100" />
                  <button
                    onClick={() => canAccess && navigate(`/campaigns/${campaign.id}/annotations`)}
                    className={`flex-1 px-3 py-2 font-medium transition-colors ${
                      canAccess
                        ? 'text-neutral-600 hover:bg-neutral-50 hover:text-brand-600 cursor-pointer'
                        : 'text-neutral-300 cursor-not-allowed'
                    }`}
                    type="button"
                    disabled={!canAccess}
                  >
                    Review
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
