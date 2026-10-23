import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { PROJECT_ROUTE, useProject } from '~/app/projectRoute';
import {
  ANNOTATION_ROUTE,
  campaignPath,
  platformAdminPath,
  projectPath,
  projectsPath,
} from '~/app/routes';
import { useCampaignSummary } from '~/features/campaigns/hooks/campaignQueries';
import {
  campaignSections,
  type CampaignSection,
} from '~/features/campaigns/utils/campaignSections';
import { useOrganizations } from '~/features/organizations/hooks/useOrganizations';
import { pendingAdminActions } from '~/features/organizations/utils/organizations';
import { projectSections, type ProjectSection } from '~/features/projects/projectSections';
import { useAccountStore } from '~/shared/stores/account.store';
import { CountBadge } from '~/shared/ui/Badge';
import { HarvestMark, HARVEST_SITE } from '~/shared/ui/HarvestMark';
import {
  IconBook,
  IconChart,
  IconExternalLink,
  IconFolder,
  IconGear,
  IconHome,
  IconMap,
  IconOverview,
  IconPencil,
  IconRobot,
  IconShield,
  IconTaskListFilled,
  IconUsers,
} from '~/shared/ui/Icons';
import { AccountMenu } from './AccountMenu';

export type AppSidebarProps = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobileOpen?: boolean;
  setMobileOpen?: (open: boolean) => void;
};

const HELP_URL = 'https://github.com/RAAPID-ORG/stacnotator/blob/main/docs/features.md';

const PROJECT_SECTION_ICON: Record<ProjectSection, ReactNode> = {
  campaigns: <IconFolder />,
  visualizers: <IconMap />,
  members: <IconUsers />,
  settings: <IconGear />,
};

const CAMPAIGN_SECTION_ICON = {
  overview: <IconOverview />,
  annotate: <IconPencil />,
  tasks: <IconTaskListFilled />,
  annotations: <IconChart />,
  agents: <IconRobot />,
  settings: <IconGear />,
};

type CampaignSectionKey = keyof typeof CAMPAIGN_SECTION_ICON;

const projectSectionPath = (projectId: number, section: ProjectSection) =>
  section === 'campaigns' ? projectPath(projectId) : `${projectPath(projectId)}?tab=${section}`;

/** The name's first letter on a tile, standing in for a logo the app does not have. */
const Monogram = ({ name }: { name: string }) => (
  <span className="flex w-5 h-5 items-center justify-center rounded bg-neutral-100 text-[10px] font-semibold text-neutral-600">
    {name.trim().charAt(0).toUpperCase() || '?'}
  </span>
);

type NavItemProps = {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  active?: boolean;
  depth?: 0 | 1 | 2;
  emphasis?: boolean;
  external?: boolean;
  trailing?: ReactNode;
  onNavigate?: () => void;
};

const DEPTH_PADDING = ['pl-2', 'pl-5', 'pl-8'] as const;

const NavItem = ({
  to,
  icon,
  label,
  collapsed,
  active = false,
  depth = 0,
  emphasis = false,
  external = false,
  trailing,
  onNavigate,
}: NavItemProps) => {
  const className = `flex w-full gap-2.5 rounded-md ${
    emphasis ? 'min-h-8 items-start py-[7px]' : 'h-8 items-center'
  } text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 ${
    collapsed ? 'justify-center' : `pr-2 ${DEPTH_PADDING[depth]}`
  } ${
    active
      ? 'bg-brand-50 font-medium text-brand-800'
      : `${emphasis ? 'font-medium text-neutral-900' : 'text-neutral-600'} hover:bg-neutral-100 hover:text-neutral-900`
  }`;
  const content = (
    <>
      <span className="relative flex w-5 h-5 shrink-0 items-center justify-center [&>svg]:w-4 [&>svg]:h-4">
        {icon}
      </span>
      {!collapsed && (
        <span className={`flex-1 min-w-0 ${emphasis ? 'break-words leading-[1.3]' : 'truncate'}`}>
          {label}
        </span>
      )}
      {!collapsed && trailing}
    </>
  );

  return external ? (
    <a href={to} target="_blank" rel="noreferrer" title={label} className={className}>
      {content}
    </a>
  ) : (
    <Link
      to={to}
      title={label}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={className}
    >
      {content}
    </Link>
  );
};

const SectionLabel = ({ children, collapsed }: { children: string; collapsed: boolean }) =>
  collapsed ? (
    <div className="mx-2 my-2 border-t border-neutral-200" />
  ) : (
    <div className="px-2 pt-5 pb-1 text-[11px] font-medium text-neutral-400">{children}</div>
  );

/**
 * Navigation, from the top: where you can go, the place you are in (a project,
 * and inside it a campaign, each with its own pages and settings), then help,
 * platform administration and the account menu. Settings sit with what they
 * configure, so there is one place to look for each.
 */
export const AppSidebar = ({
  collapsed,
  setCollapsed,
  mobileOpen = false,
  setMobileOpen,
}: AppSidebarProps) => {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const isPlatformAdmin = useAccountStore((s) => s.account?.is_platform_admin ?? false);
  const { orgs } = useOrganizations();
  const approvals = pendingAdminActions(orgs, isPlatformAdmin).organizationApprovals;

  const match = PROJECT_ROUTE.exec(pathname);
  const projectId = match ? Number(match[1]) : null;
  const campaignId = match?.[2] ? Number(match[2]) : null;
  const { project } = useProject(projectId);
  const { campaign } = useCampaignSummary(campaignId);

  const onProjectPage = projectId !== null && /^\/projects\/\d+\/?$/.test(pathname);
  const openProjectSection = new URLSearchParams(search).get('tab') ?? 'campaigns';
  const openCampaignSection: CampaignSection =
    campaignId === null
      ? null
      : ((/\/campaigns\/\d+\/(\w+)/.exec(pathname)?.[1] ?? null) as CampaignSection);

  const close = () => setMobileOpen?.(false);
  const item = { collapsed, onNavigate: close };

  return (
    <>
      {mobileOpen && (
        <div
          onClick={close}
          className="desktop:hidden fixed inset-0 bg-black/30 z-40"
          aria-hidden
        />
      )}
      <aside
        className={`flex flex-col h-full bg-white border-r border-neutral-200 fixed desktop:static inset-y-0 left-0 z-50 transform transition-transform desktop:transform-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full desktop:translate-x-0'
        }`}
        style={{
          width: collapsed ? '60px' : '232px',
          transition: 'width 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms ease',
        }}
      >
        <div className="flex items-center justify-between gap-1 px-3 min-h-12 py-2">
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <a
                href={HARVEST_SITE}
                target="_blank"
                rel="noreferrer"
                title="NASA Harvest"
                className="shrink-0"
              >
                <HarvestMark className="h-7 w-7" />
              </a>
              <span className="min-w-0 leading-tight">
                <Link
                  to="/"
                  onClick={close}
                  className="block truncate text-sm font-semibold tracking-tight text-neutral-900 hover:text-brand-700 transition-colors"
                >
                  STACNotator
                </Link>
                <span className="block truncate text-[10px] text-neutral-500">
                  {t('nav.byline')}
                </span>
              </span>
            </div>
          )}

          {ANNOTATION_ROUTE.test(pathname) && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={`p-1 text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer rounded focus:outline-none ${
                collapsed ? 'mx-auto' : ''
              }`}
              type="button"
              title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path d="M16.5 4C17.3284 4 18 4.67157 18 5.5V14.5C18 15.3284 17.3284 16 16.5 16H3.5C2.67157 16 2 15.3284 2 14.5V5.5C2 4.67157 2.67157 4 3.5 4H16.5ZM7 15H16.5C16.7761 15 17 14.7761 17 14.5V5.5C17 5.22386 16.7761 5 16.5 5H7V15ZM3.5 5C3.22386 5 3 5.22386 3 5.5V14.5C3 14.7761 3.22386 15 3.5 15H6V5H3.5Z" />
              </svg>
            </button>
          )}
        </div>

        <nav aria-label={t('nav.main')} className="flex-1 overflow-y-auto px-2 py-2">
          <div className="flex flex-col gap-px">
            <NavItem
              to="/"
              icon={<IconHome />}
              label={t('nav.home')}
              active={pathname === '/'}
              {...item}
            />
            <NavItem
              to={projectsPath()}
              icon={<IconFolder />}
              label={t('nav.projects')}
              active={pathname === projectsPath()}
              {...item}
            />
          </div>

          {project && projectId !== null && (
            <>
              <SectionLabel collapsed={collapsed}>{t('sidebar.currentProject')}</SectionLabel>
              <div className="flex flex-col gap-px" data-testid="sidebar-project">
                <NavItem
                  to={projectPath(projectId)}
                  icon={<Monogram name={project.name} />}
                  label={project.name}
                  emphasis
                  {...item}
                />
                {campaignId === null &&
                  projectSections(project).map((section) => (
                    <NavItem
                      key={section}
                      to={projectSectionPath(projectId, section)}
                      depth={1}
                      active={onProjectPage && openProjectSection === section}
                      icon={PROJECT_SECTION_ICON[section]}
                      label={t(`sidebar.projectSections.${section}`)}
                      {...item}
                    />
                  ))}
                {campaignId !== null && campaign && (
                  <>
                    <NavItem
                      to={campaignPath(projectId, campaignId)}
                      icon={<Monogram name={campaign.name} />}
                      label={campaign.name}
                      depth={1}
                      emphasis
                      {...item}
                    />
                    {campaignSections(campaign).map((section) => {
                      const key: CampaignSectionKey = section ?? 'overview';
                      return (
                        <NavItem
                          key={key}
                          to={campaignPath(projectId, campaignId, section ?? undefined)}
                          depth={2}
                          active={openCampaignSection === section}
                          icon={CAMPAIGN_SECTION_ICON[key]}
                          label={t(`sidebar.campaignSections.${key}`)}
                          {...item}
                        />
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </nav>

        <div className="flex flex-col gap-px px-2 pb-2">
          <NavItem
            to={HELP_URL}
            external
            icon={<IconBook />}
            label={t('sidebar.helpGuides')}
            trailing={<IconExternalLink className="w-3.5 h-3.5 text-neutral-300" />}
            {...item}
          />
          {isPlatformAdmin && (
            <NavItem
              to={platformAdminPath()}
              icon={
                <>
                  <IconShield />
                  {collapsed && (
                    <CountBadge
                      count={approvals}
                      label={t('sidebar.awaitingApproval')}
                      className="absolute -right-2 -top-1.5 ring-2 ring-white"
                    />
                  )}
                </>
              }
              label={t('sidebar.platformAdmin')}
              active={pathname === platformAdminPath()}
              trailing={<CountBadge count={approvals} label={t('sidebar.awaitingApproval')} />}
              {...item}
            />
          )}
        </div>

        <div className="px-2 py-2 border-t border-neutral-200">
          <AccountMenu collapsed={collapsed} onNavigate={close} />
        </div>
      </aside>
    </>
  );
};
