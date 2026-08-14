import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PROJECT_ROUTE, useProjectNavInfo } from '~/app/SidebarProjectNav';
import { useOrganizationsStore } from '~/features/organizations/stores/organizations.store';
import { useOrgStore } from '~/shared/stores/org.store';

/**
 * Keeps the workspace pointed at the organization the current page belongs to.
 *
 * Everything below a project - its campaigns, their annotation pages - is owned
 * by exactly one organization, so opening one is also a statement about where
 * the user is working. Without this the switcher could claim one organization
 * while the screen showed another's project, and "new project" would land in
 * the wrong place. Mounted once by the app shell, so it holds on every route
 * including a deep link straight into a campaign.
 */
export function useOrgScope(): void {
  const { pathname } = useLocation();
  const projectId = Number(pathname.match(PROJECT_ROUTE)?.[1]) || null;
  const organizationId = useProjectNavInfo(projectId)?.project.organization_id ?? null;
  const memberships = useOrganizationsStore((s) => s.items);

  useEffect(() => {
    if (organizationId === null) return;
    useOrgStore.getState().adoptActiveOrg(
      organizationId,
      memberships.map((org) => org.id)
    );
  }, [organizationId, memberships]);
}
