import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { IconPlus, IconDocument, IconGlobe } from '~/shared/ui/Icons';
import { Button, Input } from '~/shared/ui/forms';
import { FadeIn, MotionListItem } from '~/shared/ui/motion';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useCanCreateCampaigns } from '~/features/account/account.store';
import { listAllCampaigns, type CampaignListItemOut } from '~/api/client';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';

export const CampaignsPage = () => {
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<CampaignListItemOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'mine' | 'public'>('all');

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const canCreateCampaigns = useCanCreateCampaigns();

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
        handleError(err, 'Failed to load campaigns');
      } finally {
        setLoading(false);
      }
    };

    fetchCampaigns();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (filter === 'mine' && !(c.is_member ?? false)) return false;
      if (filter === 'public' && !(c.is_public ?? false)) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campaigns, filter, query]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading campaigns..." />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Campaigns</h1>
            <p className="page-subtitle">
              {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'} total
              {filter !== 'all' || query ? ` · ${filtered.length} shown` : ''}
            </p>
          </div>
          {canCreateCampaigns && (
            <Button
              onClick={() => navigate('/campaigns/new')}
              leading={<IconPlus className="w-4 h-4" />}
            >
              New campaign
            </Button>
          )}
        </header>

        {campaigns.length === 0 ? (
          <div className="surface">
            <div className="surface-section text-center py-16">
              <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
                <IconDocument className="w-6 h-6 text-brand-600" />
              </div>
              <p className="text-base text-neutral-800 font-medium mb-1">No campaigns yet</p>
              <p className="text-sm text-neutral-500 mb-5">
                {canCreateCampaigns
                  ? 'Create your first campaign to get started.'
                  : "You'll see campaigns here once you're added to one."}
              </p>
              {canCreateCampaigns && (
                <Button
                  onClick={() => navigate('/campaigns/new')}
                  leading={<IconPlus className="w-4 h-4" />}
                >
                  Create campaign
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="inline-flex bg-white border border-neutral-200 rounded-md p-0.5 shadow-sm">
                {(['all', 'mine', 'public'] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    type="button"
                    className={`px-3 h-7 text-xs font-medium rounded transition-colors ${
                      filter === key
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {key === 'all' ? 'All' : key === 'mine' ? 'My campaigns' : 'Public'}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-w-[14rem] max-w-sm">
                <Input
                  type="search"
                  placeholder="Search campaigns…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="surface">
              {filtered.length === 0 ? (
                <div className="p-10 text-center text-sm text-neutral-500">
                  No campaigns match your filter.
                </div>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {filtered.map((campaign, index) => (
                    <MotionListItem key={campaign.id} index={index}>
                      <CampaignRow
                        campaign={campaign}
                        onOpen={() => navigate(`/campaigns/${campaign.id}`)}
                      />
                    </MotionListItem>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </FadeIn>
    </div>
  );
};

const CampaignRow = ({
  campaign,
  onOpen,
}: {
  campaign: CampaignListItemOut;
  onOpen: () => void;
}) => {
  const isMember = campaign.is_member ?? false;
  const isAdmin = campaign.is_admin ?? false;
  const isPublic = campaign.is_public ?? false;
  const canAccess = isMember || isPublic;
  const isInitializing =
    campaign.registration_status === 'registering' || campaign.embedding_status === 'registering';
  const canOpen = canAccess && !isInitializing;

  const role = isAdmin ? 'Admin' : isMember ? 'Member' : isPublic ? 'Public' : 'No access';

  const handleRowClick = () => {
    if (canOpen) onOpen();
  };

  return (
    <li
      className={`group flex items-center gap-4 px-5 py-4 transition-colors ${
        canOpen ? 'cursor-pointer hover:bg-neutral-50/60' : 'cursor-default'
      }`}
      onClick={handleRowClick}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (canOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-neutral-900 truncate">
            {capitalizeFirst(campaign.name)}
          </h3>
          {isPublic && (
            <span title="Public campaign" aria-label="Public campaign">
              <IconGlobe className="w-3.5 h-3.5 text-brand-500 shrink-0" />
            </span>
          )}
          {isInitializing && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-800 border border-amber-200">
              <span className="w-1 h-1 rounded-full bg-amber-600 animate-pulse" />
              Initializing
            </span>
          )}
        </div>
        <p className="text-[11px] text-neutral-500 mt-0.5">{role}</p>
      </div>
    </li>
  );
};
