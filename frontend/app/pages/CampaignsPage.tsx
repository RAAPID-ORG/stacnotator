import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { CreateCampaignModal } from '~/components/campaign/campaign-create/CreateCampaignModal';
import { LoadingSpinner } from '~/components/shared/LoadingSpinner';
import { useUIStore } from '~/stores/uiStore';
import { capitalizeFirst } from '~/utils/utility';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '~/constants';
import {
  createCampaign,
  ingestAnnotationTasksFromCsv,
  listAllCampaigns,
  type CampaignCreate,
  type CampaignListItemOut,
} from '~/api/client';

export const CampaignsPage = () => {
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<CampaignListItemOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const setBreadcrumbs = useUIStore((state) => state.setBreadcrumbs);
  const showAlert = useUIStore((state) => state.showAlert);
  const showLoadingOverlay = useUIStore((state) => state.showLoadingOverlay);
  const hideLoadingOverlay = useUIStore((state) => state.hideLoadingOverlay);

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
        const message = err instanceof Error ? err.message : ERROR_MESSAGES.CAMPAIGN_LOAD_FAILED;
        showAlert(message, 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchCampaigns();
  }, [showAlert]);

  const handleCreateCampaign = async (data: CampaignCreate, taskIngestionFile: File | null) => {
    try {
      showLoadingOverlay('Creating campaign...');
      const { data: campaign } = await createCampaign({ body: data });

      if (taskIngestionFile && campaign) {
        try {
          await ingestAnnotationTasksFromCsv({
            path: { campaign_id: campaign.id },
            body: { file: taskIngestionFile },
          });
        } catch (err) {
          console.error('Failed to upload annotation tasks:', err);
          showAlert(
            'Campaign created, but failed to upload annotation tasks. Retry in campaign settings.',
            'warning'
          );
        }
      }

      setShowCreate(false);
      showAlert(SUCCESS_MESSAGES.CAMPAIGN_CREATED, 'success');
      
      // Navigate to campaign settings page
      if (campaign) {
        navigate(`/campaigns/${campaign.id}/settings`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : ERROR_MESSAGES.CAMPAIGN_CREATE_FAILED;
      showAlert(message, 'error');
      console.error(err);
    } finally {
      hideLoadingOverlay();
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading campaigns..." />
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="flex items-center mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Campaigns</h1>

        <button
          onClick={() => setShowCreate(true)}
          className="
            ml-auto
            inline-flex items-center
            px-1 py-1
            text-sm font-medium
            text-neutral-700
            border-b-3 border-b-transparent
            hover:border-b-brand-500 border-dotted
            hover:font-bold
            hover:text-brand-500
            transition-colors
            cursor-pointer
          "
        >
          + New
        </button>
      </div>

      {/* Campaign List */}
      {campaigns.length === 0 ? (
        <div className="text-center py-12">
          <svg
            className="w-12 h-12 text-neutral-700 mx-auto mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-neutral-700 mb-4">No campaigns yet</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-brand-500 bg-brand-100 text-neutral-900 rounded-lg transition-colors cursor-pointer"
          >
            Create your first campaign
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((campaign, index) => {
            const isMember = campaign.is_member ?? false;
            const isAdmin = campaign.is_admin ?? false;

            return (
              <div
                key={campaign.id}
                className="bg-white border border-neutral-300 rounded-lg hover:border-brand-500 hover:shadow-md transition-all overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-lg font-semibold text-neutral-900">
                      {capitalizeFirst(campaign.name)}
                    </h3>
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/campaigns/${campaign.id}/settings`);
                        }}
                        className="text-neutral-700 hover:text-brand-500 transition-colors hover:scale-110 active:scale-95"
                        type="button"
                        aria-label="Campaign settings"
                      >
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                          className="shrink-0 transition text-text-400 group-hover:text-text-100 cursor-pointer"
                        >
                          <path d="M10.75 2C10.75 1.58579 10.4142 1.25 10 1.25C9.58579 1.25 9.25 1.58579 9.25 2V3.01564C8.37896 3.10701 7.55761 3.36516 6.82036 3.75532L6.06066 2.99563C5.76777 2.70274 5.29289 2.70274 5 2.99563C4.70711 3.28853 4.70711 3.7634 5 4.0563L5.75968 4.81598C5.36953 5.55323 5.11138 6.37458 5.02001 7.24562H4C3.58579 7.24562 3.25 7.58141 3.25 7.99562C3.25 8.40984 3.58579 8.74562 4 8.74562H5.02001C5.11138 9.61667 5.36953 10.438 5.75968 11.1753L5 11.9349C4.70711 12.2278 4.70711 12.7027 5 12.9956C5.29289 13.2885 5.76777 13.2885 6.06066 12.9956L6.82036 12.2359C7.55761 12.6261 8.37896 12.8842 9.25 12.9756V14C9.25 14.4142 9.58579 14.75 10 14.75C10.4142 14.75 10.75 14.4142 10.75 14V12.9756C11.621 12.8842 12.4424 12.6261 13.1796 12.2359L13.9393 12.9956C14.2322 13.2885 14.7071 13.2885 15 12.9956C15.2929 12.7027 15.2929 12.2278 15 11.9349L14.2403 11.1753C14.6305 10.438 14.8886 9.61667 14.98 8.74562H16C16.4142 8.74562 16.75 8.40984 16.75 7.99562C16.75 7.58141 16.4142 7.24562 16 7.24562H14.98C14.8886 6.37458 14.6305 5.55323 14.2403 4.81598L15 4.0563C15.2929 3.7634 15.2929 3.28853 15 2.99563C14.7071 2.70274 14.2322 2.70274 13.9393 2.99563L13.1796 3.75532C12.4424 3.36516 11.621 3.10701 10.75 3.01564V2ZM10 11.4956C8.20507 11.4956 6.75 10.0406 6.75 8.24562C6.75 6.45069 8.20507 4.99562 10 4.99562C11.7949 4.99562 13.25 6.45069 13.25 8.24562C13.25 10.0406 11.7949 11.4956 10 11.4956ZM10 9.99562C11.1046 9.99562 12 9.10019 12 7.99562C12 6.89105 11.1046 5.99562 10 5.99562C8.89543 5.99562 8 6.89105 8 7.99562C8 9.10019 8.89543 9.99562 10 9.99562Z"></path>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                <div className="border-t border-gray-200 flex">
                  <button
                    onClick={() => isMember && navigate(`/campaigns/${campaign.id}/annotate`)}
                    className={`flex-1 px-4 py-2 text-sm font-normal transition-colors ${
                      isMember
                        ? 'text-neutral-700 hover:bg-neutral-100 cursor-pointer'
                        : 'text-neutral-400 cursor-not-allowed bg-neutral-50'
                    }`}
                    type="button"
                    disabled={!isMember}
                    title={!isMember ? 'You are not a member of this campaign' : ''}
                  >
                    Annotate
                  </button>
                  <div className="w-px bg-gray-200" />
                  <button
                    onClick={() => isMember && navigate(`/campaigns/${campaign.id}/annotations`)}
                    className={`flex-1 px-4 py-2 text-sm font-normal transition-colors ${
                      isMember
                        ? 'text-neutral-700 hover:bg-neutral-100 cursor-pointer'
                        : 'text-neutral-400 cursor-not-allowed bg-neutral-50'
                    }`}
                    type="button"
                    disabled={!isMember}
                    title={!isMember ? 'You are not a member of this campaign' : ''}
                  >
                    Review
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Campaign Modal */}
      {showCreate && (
        <CreateCampaignModal onClose={() => setShowCreate(false)} onSubmit={handleCreateCampaign} />
      )}
    </div>
  );
};
