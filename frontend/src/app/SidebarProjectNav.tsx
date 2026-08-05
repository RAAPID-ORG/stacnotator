import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getProject,
  listProjectCampaigns,
  type CampaignListItemOut,
  type ProjectOut,
} from '~/api/client';
import { campaignPath, projectPath } from '~/app/routes';
import { Tooltip } from '~/shared/ui/Tooltip';

interface ProjectNavInfo {
  project: ProjectOut | null;
  campaigns: CampaignListItemOut[];
}

/** One parallel fetch per project id for the whole session: the sidebar must
 *  not add request waterfalls on top of the pages that load the same data. */
const navInfoCache = new Map<number, Promise<ProjectNavInfo>>();

const loadNavInfo = (projectId: number): Promise<ProjectNavInfo> => {
  const cached = navInfoCache.get(projectId);
  if (cached) return cached;
  const pending = Promise.all([
    getProject({ path: { project_id: projectId } }),
    listProjectCampaigns({ path: { project_id: projectId } }),
  ])
    .then(([projectRes, campaignsRes]) => ({
      project: projectRes.data ?? null,
      campaigns: campaignsRes.data?.items ?? [],
    }))
    .catch(() => {
      navInfoCache.delete(projectId);
      return { project: null, campaigns: [] };
    });
  navInfoCache.set(projectId, pending);
  return pending;
};

const PROJECT_ROUTE = /^\/projects\/(\d+)(?:\/campaigns\/(\d+))?/;

/** Longer names are visually truncated in the 180px sidebar; give them a
 *  hoverable tooltip with the full text. */
const TRUNCATION_THRESHOLD = 18;

const NavName = ({ name }: { name: string }) =>
  name.length > TRUNCATION_THRESHOLD ? (
    <Tooltip text={name}>
      <span className="truncate">{name}</span>
    </Tooltip>
  ) : (
    <span className="truncate">{name}</span>
  );

interface SidebarProjectNavProps {
  onNavigate: (path: string) => void;
}

/** Wayfinding under the Projects nav item while the current route is inside a
 *  project: the project itself, its tabs the viewer can see, and the current
 *  campaign. Renders nothing outside project routes. */
export const SidebarProjectNav = ({ onNavigate }: SidebarProjectNavProps) => {
  const location = useLocation();
  const navigate = useNavigate();

  const match = location.pathname.match(PROJECT_ROUTE);
  const projectId = match ? Number(match[1]) : null;
  const campaignId = match?.[2] ? Number(match[2]) : null;

  const [info, setInfo] = useState<ProjectNavInfo | null>(null);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    loadNavInfo(projectId).then((loaded) => {
      if (!cancelled) setInfo(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (projectId === null || info?.project == null || info.project.id !== projectId) return null;

  const { project } = info;
  const campaign = campaignId === null ? null : info.campaigns.find((c) => c.id === campaignId);

  const tab = new URLSearchParams(location.search).get('tab');
  const onProjectIndex = location.pathname === projectPath(projectId);
  const canSeeMembers = (project.is_admin ?? false) || (project.is_member ?? false);

  const go = (path: string) => {
    navigate(path);
    onNavigate(path);
  };

  const itemCls = (active: boolean) =>
    `flex items-center gap-2 w-full py-1 px-2 text-left text-xs rounded-md cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 ${
      active
        ? 'text-brand-800 bg-brand-50 font-medium'
        : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
    }`;

  const entries: { key: string; label: string; path: string; active: boolean; depth: 1 | 2 }[] = [
    {
      key: 'campaigns',
      label: 'Campaigns',
      path: projectPath(projectId),
      active: onProjectIndex && tab !== 'members' && tab !== 'settings',
      depth: 1,
    },
    ...(campaign
      ? [
          {
            key: `campaign-${campaign.id}`,
            label: campaign.name,
            path: campaignPath(projectId, campaign.id),
            active: true,
            depth: 2 as const,
          },
        ]
      : []),
    ...(canSeeMembers
      ? [
          {
            key: 'members',
            label: 'Members',
            path: `${projectPath(projectId)}?tab=members`,
            active: onProjectIndex && tab === 'members',
            depth: 1 as const,
          },
        ]
      : []),
    ...(project.is_admin
      ? [
          {
            key: 'settings',
            label: 'Settings',
            path: `${projectPath(projectId)}?tab=settings`,
            active: onProjectIndex && tab === 'settings',
            depth: 1 as const,
          },
        ]
      : []),
  ];

  return (
    <div
      data-testid="sidebar-project-nav"
      className="ml-[1.4rem] pl-2 border-l border-neutral-200 flex flex-col gap-0.5 py-0.5"
    >
      <button
        type="button"
        onClick={() => go(projectPath(projectId))}
        className="flex items-center w-full py-1 px-2 text-left text-xs font-medium text-neutral-800 rounded-md cursor-pointer transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
      >
        <NavName name={project.name} />
      </button>
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => go(entry.path)}
          className={`${itemCls(entry.active)} ${entry.depth === 2 ? 'pl-4' : ''}`}
          aria-current={entry.active ? 'page' : undefined}
        >
          <NavName name={entry.label} />
        </button>
      ))}
    </div>
  );
};
