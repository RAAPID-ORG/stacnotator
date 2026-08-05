import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { campaignPath, newCampaignPath, projectsPath } from '~/app/routes';
import { primeNavInfo } from '~/app/SidebarProjectNav';
import {
  getProject,
  listProjectCampaigns,
  type CampaignListItemOut,
  type ProjectOut,
} from '~/api/client';
import { ProjectSettingsSection } from '~/features/projects/components/ProjectSettingsSection';
import { ProjectUsersSection } from '~/features/projects/components/ProjectUsersSection';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button } from '~/shared/ui/forms';
import { IconDocument, IconGlobe, IconPlus } from '~/shared/ui/Icons';
import { FadeIn, MotionListItem } from '~/shared/ui/motion';
import { SkeletonForm, SkeletonPage } from '~/shared/ui/Skeleton';
import TabNavigator from '~/shared/ui/TabNavigator';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';

const PROJECT_TABS = ['campaigns', 'members', 'settings'] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

const isProjectTab = (t: string | null): t is ProjectTab => PROJECT_TABS.some((tab) => tab === t);

export const ProjectPage = () => {
  const projectId = useProjectIdParam();
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  const [project, setProject] = useState<ProjectOut | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignListItemOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const requestedTab: ProjectTab = isProjectTab(tabParam) ? tabParam : 'campaigns';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const [projectRes, campaignsRes] = await Promise.all([
          getProject({ path: { project_id: projectId } }),
          listProjectCampaigns({ path: { project_id: projectId } }),
        ]);
        if (cancelled) return;
        setProject(projectRes.data ?? null);
        setCampaigns(campaignsRes.data?.items ?? []);
        if (projectRes.data) {
          primeNavInfo(projectId, {
            project: projectRes.data,
            campaigns: campaignsRes.data?.items ?? [],
          });
        }
      } catch (err) {
        if (!cancelled) handleError(err, 'Failed to load project');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Projects', path: projectsPath() },
      { label: project ? capitalizeFirst(project.name) : 'Project' },
    ]);
  }, [project, setBreadcrumbs]);

  if (loading) {
    return (
      <SkeletonPage>
        <SkeletonForm sections={3} />
      </SkeletonPage>
    );
  }

  if (!project) return null;

  // Keeps the sidebar nav in step with renames and other settings updates.
  const handleProjectUpdated = (updated: ProjectOut) => {
    setProject(updated);
    primeNavInfo(projectId, { project: updated, campaigns });
  };

  const isAdmin = project.is_admin ?? false;
  const canSeeMembers = isAdmin || (project.is_member ?? false);
  const availableTabs: ProjectTab[] = [
    'campaigns',
    ...(canSeeMembers ? (['members'] as const) : []),
    ...(isAdmin ? (['settings'] as const) : []),
  ];
  const activeTab = availableTabs.includes(requestedTab) ? requestedTab : 'campaigns';

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
            <h1 className="page-title">{capitalizeFirst(project.name)}</h1>
            <p className="page-subtitle">
              {project.description?.trim() ||
                `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {isAdmin && (
            <Button
              onClick={() => navigate(newCampaignPath(project.id))}
              leading={<IconPlus className="w-4 h-4" />}
            >
              New campaign
            </Button>
          )}
        </header>

        <div className="surface">
          <TabNavigator<ProjectTab>
            items={availableTabs.map((tab) => ({ id: tab, label: capitalizeFirst(tab) }))}
            activeId={activeTab}
            onChange={selectTab}
            className="!mb-0 !border-neutral-200 px-6"
          />

          <div className="p-6">
            {activeTab === 'campaigns' && (
              <CampaignsList
                campaigns={campaigns}
                canCreate={isAdmin}
                onOpen={(campaign) => navigate(campaignPath(project.id, campaign.id))}
                onCreate={() => navigate(newCampaignPath(project.id))}
              />
            )}

            {activeTab === 'members' && (
              <ProjectUsersSection projectId={project.id} canManage={isAdmin} />
            )}

            {activeTab === 'settings' && (
              <ProjectSettingsSection project={project} onUpdated={handleProjectUpdated} />
            )}
          </div>
        </div>
      </FadeIn>
    </div>
  );
};

interface CampaignsListProps {
  campaigns: CampaignListItemOut[];
  canCreate: boolean;
  onOpen: (campaign: CampaignListItemOut) => void;
  onCreate: () => void;
}

const CampaignsList = ({ campaigns, canCreate, onOpen, onCreate }: CampaignsListProps) => {
  if (campaigns.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
          <IconDocument className="w-6 h-6 text-brand-600" />
        </div>
        <p className="text-base text-neutral-800 font-medium mb-1">No campaigns yet</p>
        <p className="text-sm text-neutral-500 mb-5">
          {canCreate
            ? 'Create the first campaign in this project to get started.'
            : "You'll see campaigns here once one is created."}
        </p>
        {canCreate && (
          <Button onClick={onCreate} leading={<IconPlus className="w-4 h-4" />}>
            Create campaign
          </Button>
        )}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {campaigns.map((campaign, index) => (
        <MotionListItem key={campaign.id} index={index}>
          <CampaignRow campaign={campaign} onOpen={() => onOpen(campaign)} />
        </MotionListItem>
      ))}
    </ul>
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
  const isInitializing =
    campaign.registration_status === 'registering' || campaign.embedding_status === 'registering';
  const canOpen = (isMember || isPublic) && !isInitializing;

  const role = isAdmin ? 'Admin' : isMember ? 'Member' : isPublic ? 'Public' : 'No access';

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
