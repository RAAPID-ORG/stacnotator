import { Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { CampaignListItemOut } from '~/api/client';
import { getProjectOptions, listProjectCampaignsOptions } from '~/api/queries';
import { campaignPath, projectPath } from '~/app/routes';

const NO_CAMPAIGNS: CampaignListItemOut[] = [];

/** The project the current route is about, plus its campaigns. The one place
 *  the app resolves "which project is this", so the breadcrumb, the sidebar,
 *  the org scope and ProjectPage all read the same answer - literally the same
 *  two cache entries, so opening a project never fetches it twice. */
export const useProjectNavInfo = (projectId: number | null) => {
  // project_id is only read once `enabled` lets the query run; the placeholder
  // keeps the hooks unconditional on routes outside a project.
  const path = { project_id: projectId ?? 0 };
  const enabled = projectId !== null;

  const project = useQuery({
    ...getProjectOptions({ path }),
    enabled,
    meta: { errorMessage: 'Failed to load project' },
  });
  const campaigns = useQuery({
    ...listProjectCampaignsOptions({ path }),
    enabled,
    meta: { errorMessage: 'Failed to load campaigns' },
  });

  return {
    project: project.data,
    campaigns: campaigns.data?.items ?? NO_CAMPAIGNS,
    loading: enabled && project.isPending,
  };
};

/** Feeds the project crumb on campaign pages, whose API responses only carry
 *  the project id. */
export const useProjectName = (projectId: number | null): string | null =>
  useProjectNavInfo(projectId).project?.name ?? null;

export const PROJECT_ROUTE = /^\/projects\/(\d+)(?:\/campaigns\/(\d+))?/;

/** Longer names are visually truncated in the 180px sidebar; the native title
 *  shows the full text on hover without extra chrome. */
const NavName = ({ name }: { name: string }) => (
  <span className="min-w-0 truncate" title={name}>
    {name}
  </span>
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

  const { project, campaigns } = useProjectNavInfo(projectId);

  if (projectId === null || project === undefined) return null;

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
      active: onProjectIndex && tab === null,
      depth: 1,
    },
    ...[...campaigns]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((c) => ({
        key: `campaign-${c.id}`,
        label: c.name,
        path: campaignPath(projectId, c.id),
        active: c.id === campaignId,
        depth: 2 as const,
      })),
    {
      key: 'visualizers',
      label: 'Visualizers',
      path: `${projectPath(projectId)}?tab=visualizers`,
      active: onProjectIndex && tab === 'visualizers',
      depth: 1,
    },
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
