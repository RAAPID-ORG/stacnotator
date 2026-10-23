import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '~/app/providers/AuthProvider';
import {
  newOrganizationPath,
  organizationPath,
  organizationsPath,
  projectsPath,
  settingsPath,
} from '~/app/routes';
import { LEGAL_DOCS, legalPath } from '~/features/legal/docs';
import { useOrganizations } from '~/features/organizations/hooks/useOrganizations';
import { pendingAdminActions } from '~/features/organizations/utils/organizations';
import { useAccountStore } from '~/shared/stores/account.store';
import { useOrgStore } from '~/shared/stores/org.store';
import { Badge, CountBadge } from '~/shared/ui/Badge';
import {
  IconBuilding,
  IconCheck,
  IconDocument,
  IconGear,
  IconPlus,
  IconSelector,
  IconSignOut,
} from '~/shared/ui/Icons';
import { handleError } from '~/shared/utils/errorHandler';
import { MenuItem, MenuLabel, MenuSeparator, SidebarMenu } from './SidebarMenu';

const initial = (text: string) => text.trim().charAt(0).toUpperCase() || '?';

/** A small action beside the organization heading, so browsing and creating
 *  read as about organizations rather than as one more organization to pick. */
const OrgAction = ({
  icon,
  children,
  onSelect,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onSelect}
    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-500 cursor-pointer transition-colors hover:bg-neutral-100 hover:text-neutral-900 [&>svg]:w-3 [&>svg]:h-3"
  >
    {icon}
    {children}
  </button>
);

/**
 * Who is signed in and which organization they are working in - one row,
 * because most people belong to a single organization. Its menu holds
 * everything personal and everything about the organization, so each kind of
 * setting has one place to look.
 */
export const AccountMenu = ({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) => {
  const navigate = useNavigate();
  const { auth } = useAuth();
  const account = useAccountStore((s) => s.account);
  const { orgs, loading } = useOrganizations();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const setActiveOrgId = useOrgStore((s) => s.setActiveOrgId);

  const isPlatformAdmin = account?.is_admin ?? false;
  const activeOrg = orgs.find((org) => org.id === activeOrgId);
  const canManage = activeOrg !== undefined && (isPlatformAdmin || (activeOrg.is_admin ?? false));
  const accessRequests = pendingAdminActions(orgs, false).accessRequests;
  const name = account?.display_name || account?.email || '';

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  /** Switching organization is a move, not a filter: the page you were on
   *  belongs to the organization you just left, so it lands on the new one's
   *  projects. */
  const switchTo = (id: number | null) => {
    setActiveOrgId(id);
    go(projectsPath());
  };

  const signOut = async () => {
    try {
      await auth.logout();
      navigate('/');
    } catch (err) {
      handleError(err, 'Sign out failed');
    }
  };

  return (
    <SidebarMenu
      label="Account and organization"
      testId="account-menu"
      trigger={
        <span className={`flex items-center gap-2.5 h-11 ${collapsed ? 'justify-center' : 'px-2'}`}>
          <span className="relative shrink-0">
            <span className="flex w-7 h-7 items-center justify-center rounded-full bg-brand-50 border border-brand-200 text-brand-800 text-[11px] font-semibold">
              {initial(name)}
            </span>
            {collapsed && (
              <CountBadge
                count={accessRequests}
                label="requests waiting on you"
                className="absolute -right-1.5 -top-1.5 ring-2 ring-white"
              />
            )}
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 min-w-0 leading-tight">
                <span className="block truncate text-[13px] font-medium text-neutral-800">
                  {name}
                </span>
                <span className="block truncate text-[11px] text-neutral-500">
                  {loading ? ' ' : (activeOrg?.name ?? 'No organization')}
                </span>
              </span>
              <CountBadge count={accessRequests} label="requests waiting on you" />
              <IconSelector className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
            </>
          )}
        </span>
      }
    >
      {(close) => {
        const run = (action: () => void) => () => {
          close();
          action();
        };
        return (
          <>
            {account?.email && <MenuLabel>{account.email}</MenuLabel>}
            <MenuItem icon={<IconGear />} onSelect={run(() => go(settingsPath()))}>
              Account settings
            </MenuItem>
            {canManage && (
              <MenuItem
                icon={<IconGear />}
                testId="organization-settings"
                onSelect={run(() => go(organizationPath(activeOrg.id)))}
                trailing={
                  <CountBadge
                    count={activeOrg.pending_access_requests ?? 0}
                    label="access requests"
                  />
                }
              >
                Organization settings
              </MenuItem>
            )}

            <MenuSeparator />
            <div className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-1">
              <span className="text-[11px] font-medium text-neutral-400">Organization</span>
              <span className="flex items-center gap-0.5">
                <OrgAction icon={<IconBuilding />} onSelect={run(() => go(organizationsPath()))}>
                  Browse
                </OrgAction>
                <OrgAction icon={<IconPlus />} onSelect={run(() => go(newOrganizationPath()))}>
                  New
                </OrgAction>
              </span>
            </div>
            {orgs.map((org) => (
              <MenuItem
                key={org.id}
                checked={org.id === activeOrgId}
                icon={org.id === activeOrgId ? <IconCheck className="text-brand-600" /> : null}
                onSelect={run(() => switchTo(org.id))}
                trailing={
                  org.status === 'pending' ? (
                    <Badge tone="yellow">Pending</Badge>
                  ) : (
                    org.id !== activeOrgId && (
                      <CountBadge
                        count={org.pending_access_requests ?? 0}
                        label="access requests"
                      />
                    )
                  )
                }
              >
                {org.name}
              </MenuItem>
            ))}
            <MenuItem
              checked={activeOrgId === null}
              icon={activeOrgId === null ? <IconCheck className="text-brand-600" /> : null}
              onSelect={run(() => switchTo(null))}
            >
              <span className="text-neutral-500">No organization</span>
            </MenuItem>

            <MenuSeparator />
            {LEGAL_DOCS.map((doc) => (
              <MenuItem
                key={doc.key}
                icon={<IconDocument />}
                href={legalPath(doc.key)}
                onSelect={close}
              >
                {doc.title}
              </MenuItem>
            ))}

            <MenuSeparator />
            <MenuItem icon={<IconSignOut />} tone="danger" onSelect={run(() => void signOut())}>
              Sign out
            </MenuItem>
          </>
        );
      }}
    </SidebarMenu>
  );
};
