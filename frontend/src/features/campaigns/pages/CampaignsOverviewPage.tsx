import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { IconPlus, IconDocument, IconGear, IconGlobe } from '~/shared/ui/Icons';
import { Button, Input } from '~/shared/ui/forms';
import { FadeIn, motion, listContainerVariants, listItemVariants } from '~/shared/ui/motion';
import { useLayoutStore } from '~/features/layout/layout.store';
import { listAllCampaigns, type CampaignListItemOut } from '~/api/client';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';

/**
 * CampaignsOverviewPage shows every campaign the user can see as a single
 * calm list - no card grid. Rows hold the campaign name + a small status
 * pill on the left, and inline Annotate / Review / Settings actions on the
 * right that surface clearly. Filter and search live above the list as
 * page-level controls. The whole page sits on the warm canvas with one
 * elevated surface holding the list - same shape every other page uses.
 */
export const CampaignsPage = () => {
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<CampaignListItemOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'mine' | 'public'>('all');

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

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
          <Button
            onClick={() => navigate('/campaigns/new')}
            leading={<IconPlus className="w-4 h-4" />}
          >
            New campaign
          </Button>
        </header>

        {campaigns.length === 0 ? (
          <div className="surface">
            <div className="surface-section text-center py-16">
              <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
                <IconDocument className="w-6 h-6 text-brand-600" />
              </div>
              <p className="text-base text-neutral-800 font-medium mb-1">No campaigns yet</p>
              <p className="text-sm text-neutral-500 mb-5">
                Create your first campaign to get started.
              </p>
              <Button
                onClick={() => navigate('/campaigns/new')}
                leading={<IconPlus className="w-4 h-4" />}
              >
                Create campaign
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Filter + search bar - sits above the list as a quiet toolbar.
                No card around it; just live on the canvas. */}
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

            {/* The list itself - one elevated surface, hairline divided rows */}
            <div className="surface">
              {filtered.length === 0 ? (
                <div className="p-10 text-center text-sm text-neutral-500">
                  No campaigns match your filter.
                </div>
              ) : (
                <motion.ul
                  className="divide-y divide-neutral-100"
                  variants={listContainerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {filtered.map((campaign) => (
                    <motion.div key={campaign.id} variants={listItemVariants} layout>
                      <CampaignRow
                        campaign={campaign}
                        onAnnotate={() => navigate(`/campaigns/${campaign.id}/annotate`)}
                        onReview={() => navigate(`/campaigns/${campaign.id}/annotations`)}
                        onSettings={() => navigate(`/campaigns/${campaign.id}/settings`)}
                      />
                    </motion.div>
                  ))}
                </motion.ul>
              )}
            </div>
          </>
        )}
      </FadeIn>
    </div>
  );
};

/** A single campaign row in the calm list. Click anywhere on the row to
 *  open the annotator (when accessible). Inline secondary actions surface
 *  on the right. */
const CampaignRow = ({
  campaign,
  onAnnotate,
  onReview,
  onSettings,
}: {
  campaign: CampaignListItemOut;
  onAnnotate: () => void;
  onReview: () => void;
  onSettings: () => void;
}) => {
  const isMember = campaign.is_member ?? false;
  const isAdmin = campaign.is_admin ?? false;
  const isPublic = campaign.is_public ?? false;
  const canAccess = isMember || isPublic;
  const isInitializing =
    campaign.registration_status === 'registering' || campaign.embedding_status === 'registering';
  const canAnnotate = canAccess && !isInitializing;

  // Quiet meta line: role + access level
  const role = isAdmin ? 'Admin' : isMember ? 'Member' : isPublic ? 'Public' : 'No access';

  // The whole row is clickable when accessible. Inner buttons stop
  // propagation so settings + review work without bubbling to row click.
  const handleRowClick = () => {
    if (canAnnotate) onAnnotate();
  };

  return (
    <li
      className={`group flex items-center gap-4 px-5 py-4 transition-colors ${
        canAnnotate ? 'cursor-pointer hover:bg-neutral-50/60' : 'cursor-default'
      }`}
      onClick={handleRowClick}
      role={canAnnotate ? 'button' : undefined}
      tabIndex={canAnnotate ? 0 : undefined}
      onKeyDown={(e) => {
        if (canAnnotate && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onAnnotate();
        }
      }}
    >
      {/* Left column: name + meta */}
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

      {/* Right column: secondary actions. Stop propagation so row click only
          fires for "annotate" (the primary). */}
      <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReview();
          }}
          disabled={!canAccess}
          className="inline-flex items-center h-8 px-3 text-xs font-medium text-neutral-600 rounded-md hover:bg-neutral-100 disabled:text-neutral-300 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
          type="button"
        >
          Review
        </button>
        {isAdmin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSettings();
            }}
            className="inline-flex items-center justify-center h-8 w-8 text-neutral-400 hover:text-neutral-700 rounded-md hover:bg-neutral-100 transition-colors"
            type="button"
            aria-label="Campaign settings"
            title="Campaign settings"
          >
            <IconGear className="w-4 h-4" />
          </button>
        )}
      </div>
    </li>
  );
};
