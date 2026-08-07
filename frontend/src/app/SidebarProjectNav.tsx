import { Fragment, useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getProject,
  listProjectCampaigns,
  type CampaignListItemOut,
  type ProjectOut,
} from '~/api/client';
import { campaignPath, projectPath } from '~/app/routes';
import { Tooltip } from '~/shared/ui/Tooltip';

export interface ProjectNavInfo {
  project: ProjectOut;
  campaigns: CampaignListItemOut[];
}

const navInfoCache = new Map<number, ProjectNavInfo>();
const pendingLoads = new Set<number>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Pages that already fetched the project (ProjectPage) feed the sidebar so
 *  it never double-fetches and immediately reflects renames or campaign-list
 *  changes. */
export const primeNavInfo = (projectId: number, info: ProjectNavInfo) => {
  navInfoCache.set(projectId, info);
  notify();
};

/** The cache is identity-scoped; sign-out drops it alongside the org stores. */
export const clearNavInfoCache = () => {
  navInfoCache.clear();
  pendingLoads.clear();
  notify();
};

/** Fallback for deep entry (straight into a campaign route) where ProjectPage
 *  never mounted to prime the cache: one parallel fetch per project id. */
const ensureNavInfo = (projectId: number) => {
  if (navInfoCache.has(projectId) || pendingLoads.has(projectId)) return;
  pendingLoads.add(projectId);
  Promise.all([
    getProject({ path: { project_id: projectId } }),
    listProjectCampaigns({ path: { project_id: projectId } }),
  ])
    .then(([projectRes, campaignsRes]) => {
      if (projectRes.data) {
        primeNavInfo(projectId, {
          project: projectRes.data,
          campaigns: campaignsRes.data?.items ?? [],
        });
      }
    })
    .catch(() => undefined)
    .finally(() => pendingLoads.delete(projectId));
};

/** Project name from the nav cache, fetched on demand for deep entries.
 *  Feeds the project crumb on campaign pages, whose API responses only carry
 *  the project id. */
export const useProjectName = (projectId: number | null): string | null => {
  const info = useSyncExternalStore(subscribe, () =>
    projectId === null ? undefined : navInfoCache.get(projectId)
  );
  useEffect(() => {
    if (projectId !== null) ensureNavInfo(projectId);
  }, [projectId]);
  return info?.project.name ?? null;
};

const PROJECT_ROUTE = /^\/projects\/(\d+)(?:\/campaigns\/(\d+))?/;

/** Longer names are visually truncated in the 180px sidebar; give them a
 *  hoverable tooltip with the full text. */
const TRUNCATION_THRESHOLD = 18;

const NavName = ({ name }: { name: string }) =>
  name.length > TRUNCATION_THRESHOLD ? (
    <Tooltip text={name} align="start" className="min-w-0">
      <span className="min-w-0 truncate">{name}</span>
    </Tooltip>
  ) : (
    <span className="min-w-0 truncate">{name}</span>
  );

interface SidebarProjectNavProps {
  onNavigate: (path: string) => void;
}

/** Wayfinding under the Projects nav item while the current route is inside a
 *  project: the project itself, its tabs the viewer can see, and every
 *  campaign of the project (alphabetical, current one highlighted). Renders
 *  nothing outside project routes. */
export const SidebarProjectNav = ({ onNavigate }: SidebarProjectNavProps) => {
  const location = useLocation();
  const navigate = useNavigate();

  const match = location.pathname.match(PROJECT_ROUTE);
  const projectId = match ? Number(match[1]) : null;
  const campaignId = match?.[2] ? Number(match[2]) : null;

  // On the project index ProjectPage is about to prime the cache with its own
  // fetches; only deeper routes need the standalone fallback load.
  const onProjectIndexRoute = projectId !== null && location.pathname === projectPath(projectId);

  const info = useSyncExternalStore(subscribe, () =>
    projectId === null ? undefined : navInfoCache.get(projectId)
  );

  useEffect(() => {
    if (projectId !== null && !onProjectIndexRoute) ensureNavInfo(projectId);
  }, [projectId, onProjectIndexRoute]);

  if (projectId === null || info === undefined) return null;

  const { project } = info;

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
        : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/60'
    }`;

  const entries: { key: string; label: string; path: string; active: boolean; depth: 1 | 2 }[] = [
    {
      key: 'campaigns',
      label: 'Campaigns',
      path: projectPath(projectId),
      active: onProjectIndex && tab !== 'members' && tab !== 'settings',
      depth: 1,
    },
    ...[...info.campaigns]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((c) => ({
        key: `campaign-${c.id}`,
        label: c.name,
        path: campaignPath(projectId, c.id),
        active: c.id === campaignId,
        depth: 2 as const,
      })),
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
      {/* Group title, not a link - the Campaigns entry below already opens the
          project index. */}
      <div className="flex items-center px-2 text-xs font-medium text-neutral-600 select-none">
        <NavName name={project.name} />
      </div>
      {entries.map((entry) => {
        const button = (
          <button
            type="button"
            onClick={() => go(entry.path)}
            className={itemCls(entry.active)}
            aria-current={entry.active ? 'page' : undefined}
          >
            <NavName name={entry.label} />
          </button>
        );
        return entry.depth === 2 ? (
          <div key={entry.key} className="ml-2 pl-1.5 border-l border-neutral-200">
            {button}
          </div>
        ) : (
          <Fragment key={entry.key}>{button}</Fragment>
        );
      })}
    </div>
  );
};
