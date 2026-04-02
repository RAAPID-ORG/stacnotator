import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayoutStore } from 'src/features/layout/layout.store';
import { listAllCampaigns, type CampaignListItemOut } from '~/api/client';
import { capitalizeFirst } from '~/shared/utils/utility';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { IconDocument, IconWarning, IconPlay } from '~/shared/ui/Icons';

export const HomePage = () => {
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  const [campaigns, setCampaigns] = useState<CampaignListItemOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    listAllCampaigns()
      .then(({ data }) => setCampaigns(data?.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const recentCampaigns = campaigns.slice(0, 6);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-8 pt-6 pb-12">
        {/* Hero */}
        <div className="mb-6">
          <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">
            STACNotator
          </h1>
          <p className="text-sm text-neutral-500 mt-1.5 leading-relaxed max-w-lg">
            Geospatial imagery annotation platform. Create campaigns, configure STAC imagery
            sources, and annotate features collaboratively.
          </p>
        </div>

        {/* Early access + Video */}
        <div className="mb-8">
          <div className="rounded-xl border border-neutral-200 overflow-hidden">
            {/* Early access banner */}
            <div className="px-4 py-2.5 bg-amber-50/60 border-b border-amber-200/60 flex gap-2.5 items-center">
              <IconWarning className="shrink-0 w-3.5 h-3.5 text-amber-500" />
              <p className="text-[11px] text-amber-700/80 leading-relaxed">
                <strong className="font-semibold text-amber-800">Early Access</strong> - Under
                active development. Features may change and results should be independently
                verified. No warranty or liability is provided regarding the correctness or
                completeness of any outputs.
              </p>
            </div>
            {/* Video placeholder */}
            <div className="bg-neutral-900 aspect-video flex items-center justify-center relative group cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-700/20 to-neutral-900/80" />
              <div className="relative text-center">
                <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mx-auto mb-3 group-hover:bg-white/20 group-hover:scale-105 transition-all">
                  <IconPlay className="w-7 h-7 text-white" />
                </div>
                <p className="text-sm font-medium text-white/90">
                  Getting Started with STACNotator
                </p>
                <p className="text-xs text-white/50 mt-1">Video tutorial coming soon</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent campaigns */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              Recent Campaigns
            </h2>
            {campaigns.length > 6 && (
              <button
                onClick={() => navigate('/campaigns')}
                className="text-xs text-brand-600 hover:text-brand-800 cursor-pointer transition-colors"
              >
                View all
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-8">
              <LoadingSpinner size="sm" text="Loading campaigns..." />
            </div>
          ) : recentCampaigns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-3">
                <IconDocument className="w-6 h-6 text-brand-500" />
              </div>
              <p className="text-sm text-neutral-600 mb-1 font-medium">No campaigns yet</p>
              <p className="text-xs text-neutral-400 mb-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentCampaigns.map((campaign) => {
                const isMember = campaign.is_member ?? false;
                const _isAdmin = campaign.is_admin ?? false;
                const isPublic = campaign.is_public ?? false;
                const canAccess = isMember || isPublic;

                return (
                  <button
                    key={campaign.id}
                    onClick={() => canAccess && navigate(`/campaigns/${campaign.id}/annotate`)}
                    disabled={!canAccess}
                    className={`group text-left rounded-lg border bg-white p-4 transition-all ${
                      canAccess
                        ? 'border-neutral-200 hover:border-brand-400 hover:shadow-md cursor-pointer'
                        : 'border-neutral-100 bg-neutral-50 cursor-not-allowed opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
                        <IconDocument className="w-4 h-4 text-brand-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-neutral-800 truncate leading-tight">
                          {capitalizeFirst(campaign.name)}
                        </h3>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
