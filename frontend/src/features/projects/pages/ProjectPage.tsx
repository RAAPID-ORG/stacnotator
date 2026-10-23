import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

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
import { Skeleton, SkeletonRows } from '~/shared/ui/Skeleton';
import {
  isProjectSection,
  projectSections,
  type ProjectSection,
} from '~/features/projects/projectSections';
import { capitalizeFirst } from '~/shared/utils/utility';
import { ProjectVisualizersSection } from '~/features/visualizers/ProjectVisualizersSection';

const NO_CAMPAIGNS: CampaignListItemOut[] = [];

const REGISTRATION_POLL_MS = 5000;

export const ProjectPage = () => {
  const { t } = useTranslation('projects');
  const projectId = useProjectIdParam();
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  const showAlert = useLayoutStore((state) => state.showAlert);

  const [duplicating, setDuplicating] = useState<CampaignListItemOut | null>(null);
  const [searchParams] = useSearchParams();

  const sectionParam = searchParams.get('tab');
  const requestedSection: ProjectSection = isProjectSection(sectionParam)
    ? sectionParam
    : 'campaigns';

  const { project, loading } = useProject(projectId);
  const { data: campaignsData } = useQuery({
    ...listProjectCampaignsOptions({ path: { project_id: projectId } }),
    meta: { errorMessage: t('page.loadCampaignsFailed') },
    // Background setup finishes without a user action, so the badge has to
    // clear itself. Stops as soon as nothing is registering.
    refetchInterval: (query) =>
      query.state.data?.items.some(isRegistering) ? REGISTRATION_POLL_MS : false,
  });
  const campaigns = campaignsData?.items ?? NO_CAMPAIGNS;

  useEffect(() => {
    setBreadcrumbs([
      { label: t('breadcrumb'), path: projectsPath() },
      { label: project ? capitalizeFirst(project.name) : t('page.breadcrumb') },
    ]);
  }, [project, setBreadcrumbs, t]);

  if (!loading && !project) return null;

  // Land in the copy's settings - the whole point of duplicating is tweaking
  // the few remaining differences right away - which is in the project the
  // copy went to, not necessarily this one.
  const handleDuplicated = (created: CampaignOut) => {
    setDuplicating(null);
    showAlert(t('page.duplicated', { name: created.name }), 'success');
    navigate(campaignPath(created.project_id, created.id, 'settings'));
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
          <ProjectSectionView
            project={project}
            campaigns={campaigns}
            requestedSection={requestedSection}
            onOpenCampaign={(campaign) => navigate(campaignPath(project.id, campaign.id))}
            onOpenCampaignSettings={(campaign) =>
              navigate(campaignPath(project.id, campaign.id, 'settings'))
            }
            onCreateCampaign={() => navigate(newCampaignPath(project.id))}
            onDuplicateCampaign={setDuplicating}
          />
        ) : (
          <SkeletonRows count={4} />
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

interface ProjectSectionViewProps {
  project: ProjectOut;
  campaigns: CampaignListItemOut[];
  requestedSection: ProjectSection;
  onOpenCampaign: (campaign: CampaignListItemOut) => void;
  onOpenCampaignSettings: (campaign: CampaignListItemOut) => void;
  onCreateCampaign: () => void;
  onDuplicateCampaign: (campaign: CampaignListItemOut) => void;
}

/** One section of the project, chosen in the sidebar. */
const ProjectSectionView = ({
  project,
  campaigns,
  requestedSection,
  onOpenCampaign,
  onOpenCampaignSettings,
  onCreateCampaign,
  onDuplicateCampaign,
}: ProjectSectionViewProps) => {
  const isAdmin = project.is_admin ?? false;
  const activeTab = projectSections(project).includes(requestedSection)
    ? requestedSection
    : 'campaigns';

  return (
    <div className="surface">
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
}: CampaignsListProps) => {
  const { t } = useTranslation('projects');
  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="section-heading">{t('page.campaigns')}</h2>
          <p className="section-description">{t('page.campaignsDescription')}</p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={onCreate} leading={<IconPlus className="h-4 w-4" />}>
            {t('page.newCampaign')}
          </Button>
        )}
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200 px-6 py-10 text-center">
          <IconDocument className="mx-auto h-6 w-6 text-neutral-300" />
          <p className="mt-2 text-sm text-neutral-600">{t('page.noCampaigns')}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {canCreate ? t('page.noCampaignsCanCreate') : t('page.noCampaignsCannotCreate')}
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
};

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
  const { t } = useTranslation('projects');
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
          <span title={t('page.publicCampaign')} aria-label={t('page.publicCampaign')}>
            <IconGlobe className="w-3.5 h-3.5 text-brand-500 shrink-0" />
          </span>
        )}
        {initializing && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-800 border border-amber-200">
            <span className="w-1 h-1 rounded-full bg-amber-600 animate-pulse" />
            {t('page.initializing')}
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
          title={t('page.campaignSettings')}
          aria-label={t('page.settingsFor', { name: campaign.name })}
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
          title={t('page.duplicateCampaign')}
          aria-label={t('page.duplicate', { name: campaign.name })}
          data-testid="duplicate-campaign"
        >
          <IconCopy className="h-4 w-4" />
        </button>
      )}
    </li>
  );
};
