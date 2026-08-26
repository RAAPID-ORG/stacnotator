import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useQuery } from '@tanstack/react-query';
import { campaignPath, newCampaignPath, projectsPath } from '~/app/routes';
import { useProject } from '~/app/projectRoute';
import { listProjectCampaignsOptions } from '~/api/queries';
import { isRegistering } from '~/features/campaigns/hooks/campaignQueries';
import { type CampaignListItemOut, type CampaignOut, type ProjectOut } from '~/api/client';
import { DuplicateCampaignModal } from '~/features/campaigns/components/DuplicateCampaignModal';
import { ProjectSettingsSection } from '~/features/projects/components/ProjectSettingsSection';
import { ProjectUsersSection } from '~/features/projects/components/ProjectUsersSection';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button } from '~/shared/ui/forms';
import { IconCopy, IconDocument, IconGlobe, IconPlus, IconSettings } from '~/shared/ui/Icons';
import { FadeIn, MotionListItem } from '~/shared/ui/motion';
import { Delayed } from '~/shared/ui/Delayed';
import { Skeleton, SkeletonRows } from '~/shared/ui/Skeleton';
import TabNavigator from '~/shared/ui/TabNavigator';
import { capitalizeFirst } from '~/shared/utils/utility';
import { ProjectVisualizersSection } from '~/features/visualizers/ProjectVisualizersSection';

const PROJECT_TABS = ['campaigns', 'visualizers', 'members', 'settings'] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

const isProjectTab = (t: string | null): t is ProjectTab => PROJECT_TABS.some((tab) => tab === t);

const NO_CAMPAIGNS: CampaignListItemOut[] = [];

const REGISTRATION_POLL_MS = 5000;

export const ProjectPage = () => {
  const projectId = useProjectIdParam();
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  const showAlert = useLayoutStore((state) => state.showAlert);

  const [duplicating, setDuplicating] = useState<CampaignListItemOut | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const requestedTab: ProjectTab = isProjectTab(tabParam) ? tabParam : 'campaigns';

  const { project, loading } = useProject(projectId);
  const { data: campaignsData } = useQuery({
    ...listProjectCampaignsOptions({ path: { project_id: projectId } }),
    meta: { errorMessage: 'Failed to load campaigns' },
    // Background setup finishes without a user action, so the badge has to
    // clear itself. Stops as soon as nothing is registering.
    refetchInterval: (query) =>
      query.state.data?.items.some(isRegistering) ? REGISTRATION_POLL_MS : false,
  });
  const campaigns = campaignsData?.items ?? NO_CAMPAIGNS;

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Projects', path: projectsPath() },
      { label: project ? capitalizeFirst(project.name) : 'Project' },
    ]);
  }, [project, setBreadcrumbs]);

  if (!loading && !project) return null;

  // Land in the copy's settings: the whole point of duplicating is tweaking
  // the few remaining differences right away.
  const handleDuplicated = (created: CampaignOut) => {
    setDuplicating(null);
    showAlert(`Campaign duplicated as "${created.name}"`, 'success');
    navigate(campaignPath(projectId, created.id, 'settings'));
  };

  const selectTab = (tab: ProjectTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'campaigns') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            {project ? (
              <h1 className="page-title">{capitalizeFirst(project.name)}</h1>
            ) : (
              <Skeleton className="h-7 w-52" />
            )}
            {project ? (
              project.description?.trim() && (
                <p className="page-subtitle">{project.description.trim()}</p>
              )
            ) : (
              <Skeleton className="h-4 w-64 mt-2" />
            )}
          </div>
        </header>

        {project ? (
          <ProjectTabs
            project={project}
            campaigns={campaigns}
            requestedTab={requestedTab}
            onSelectTab={selectTab}
            onOpenCampaign={(campaign) => navigate(campaignPath(project.id, campaign.id))}
            onOpenCampaignSettings={(campaign) =>
              navigate(campaignPath(project.id, campaign.id, 'settings'))
            }
            onCreateCampaign={() => navigate(newCampaignPath(project.id))}
            onDuplicateCampaign={setDuplicating}
          />
        ) : (
          <Delayed>
            <SkeletonRows count={4} />
          </Delayed>
        )}

        {duplicating && (
          <DuplicateCampaignModal
            campaign={duplicating}
            onClose={() => setDuplicating(null)}
            onDuplicated={handleDuplicated}
          />
        )}
      </FadeIn>
    </div>
  );
};

interface ProjectTabsProps {
  project: ProjectOut;
  campaigns: CampaignListItemOut[];
  requestedTab: ProjectTab;
  onSelectTab: (tab: ProjectTab) => void;
  onOpenCampaign: (campaign: CampaignListItemOut) => void;
  onOpenCampaignSettings: (campaign: CampaignListItemOut) => void;
  onCreateCampaign: () => void;
  onDuplicateCampaign: (campaign: CampaignListItemOut) => void;
}

const ProjectTabs = ({
  project,
  campaigns,
  requestedTab,
  onSelectTab,
  onOpenCampaign,
  onOpenCampaignSettings,
  onCreateCampaign,
  onDuplicateCampaign,
}: ProjectTabsProps) => {
  const isAdmin = project.is_admin ?? false;
  const canSeeMembers = isAdmin || (project.is_member ?? false);
  const availableTabs: ProjectTab[] = [
    'campaigns',
    'visualizers',
    ...(canSeeMembers ? (['members'] as const) : []),
    ...(isAdmin ? (['settings'] as const) : []),
  ];
  const activeTab = availableTabs.includes(requestedTab) ? requestedTab : 'campaigns';

  return (
    <div className="surface">
      <TabNavigator<ProjectTab>
        items={availableTabs.map((tab) => ({ id: tab, label: capitalizeFirst(tab) }))}
        activeId={activeTab}
        onChange={onSelectTab}
        className="!mb-0 !border-neutral-200 px-6"
      />

      <div className="p-6">
        {activeTab === 'campaigns' && (
          <CampaignsList
            campaigns={campaigns}
            canCreate={isAdmin}
            onOpen={onOpenCampaign}
            onOpenSettings={onOpenCampaignSettings}
            onCreate={onCreateCampaign}
            onDuplicate={onDuplicateCampaign}
          />
        )}

        {activeTab === 'visualizers' && (
          <ProjectVisualizersSection projectId={project.id} canManage={isAdmin} />
        )}

        {activeTab === 'members' && (
          <ProjectUsersSection projectId={project.id} canManage={isAdmin} />
        )}

        {activeTab === 'settings' && <ProjectSettingsSection project={project} />}
      </div>
    </div>
  );
};

interface CampaignsListProps {
  campaigns: CampaignListItemOut[];
  canCreate: boolean;
  onOpen: (campaign: CampaignListItemOut) => void;
  onOpenSettings: (campaign: CampaignListItemOut) => void;
  onCreate: () => void;
  onDuplicate: (campaign: CampaignListItemOut) => void;
}

const CampaignsList = ({
  campaigns,
  canCreate,
  onOpen,
  onOpenSettings,
  onCreate,
  onDuplicate,
}: CampaignsListProps) => (
  <>
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="section-heading">Campaigns</h2>
        <p className="section-description">
          Label remote sensing imagery interactively with your team either task based or
          explorative.
        </p>
      </div>
      {canCreate && (
        <Button size="sm" onClick={onCreate} leading={<IconPlus className="h-4 w-4" />}>
          New campaign
        </Button>
      )}
    </div>

    {campaigns.length === 0 ? (
      <div className="rounded-lg border border-dashed border-neutral-200 px-6 py-10 text-center">
        <IconDocument className="mx-auto h-6 w-6 text-neutral-300" />
        <p className="mt-2 text-sm text-neutral-600">No campaigns yet.</p>
        <p className="mt-1 text-xs text-neutral-500">
          {canCreate
            ? 'Create the first one in this project to get started.'
            : "You'll see campaigns here once one is created."}
        </p>
      </div>
    ) : (
      <ul className="divide-y divide-neutral-100">
        {campaigns.map((campaign, index) => (
          <MotionListItem key={campaign.id} index={index}>
            <CampaignRow
              campaign={campaign}
              onOpen={() => onOpen(campaign)}
              onOpenSettings={() => onOpenSettings(campaign)}
              onDuplicate={() => onDuplicate(campaign)}
            />
          </MotionListItem>
        ))}
      </ul>
    )}
  </>
);

const CampaignRow = ({
  campaign,
  onOpen,
  onOpenSettings,
  onDuplicate,
}: {
  campaign: CampaignListItemOut;
  onOpen: () => void;
  onOpenSettings: () => void;
  onDuplicate: () => void;
}) => {
  const isMember = campaign.is_member ?? false;
  const isAdmin = campaign.is_admin ?? false;
  const isPublic = campaign.is_public ?? false;
  const initializing = isRegistering(campaign);
  // Setup runs in the background for minutes; the campaign's own pages explain
  // that and let an admin keep editing settings meanwhile. Only annotating is
  // actually blocked, and the annotation page gates itself.
  const canOpen = isMember || isPublic;

  return (
    <li
      data-testid="campaign-row"
      className={`group flex items-center gap-4 px-5 py-4 transition-colors ${
        canOpen ? 'cursor-pointer hover:bg-neutral-50/60' : 'cursor-default'
      }`}
      onClick={() => {
        if (canOpen) onOpen();
      }}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (canOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-900 truncate">
          {capitalizeFirst(campaign.name)}
        </h3>
        {isPublic && (
          <span title="Public campaign" aria-label="Public campaign">
            <IconGlobe className="w-3.5 h-3.5 text-brand-500 shrink-0" />
          </span>
        )}
        {initializing && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-800 border border-amber-200">
            <span className="w-1 h-1 rounded-full bg-amber-600 animate-pulse" />
            Initializing
          </span>
        )}
      </div>
      {isAdmin && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings();
          }}
          className="shrink-0 grid h-8 w-8 place-items-center rounded-md text-neutral-400 opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 hover:bg-neutral-200/60 hover:text-neutral-700 cursor-pointer"
          title="Campaign settings"
          aria-label={`Settings for ${campaign.name}`}
          data-testid="campaign-settings"
        >
          <IconSettings className="h-4 w-4" />
        </button>
      )}
      {isAdmin && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="shrink-0 grid h-8 w-8 place-items-center rounded-md text-neutral-400 opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 hover:bg-neutral-200/60 hover:text-neutral-700 cursor-pointer"
          title="Duplicate campaign"
          aria-label={`Duplicate ${campaign.name}`}
          data-testid="duplicate-campaign"
        >
          <IconCopy className="h-4 w-4" />
        </button>
      )}
    </li>
  );
};
