import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PROJECT_ROUTE, useProject } from '~/app/projectRoute';
import { useOrganizations } from '~/features/organizations/hooks/useOrganizations';
import { reconcileActiveOrgId } from '~/features/organizations/utils/organizations';
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
  const organizationId = useProject(projectId).project?.organization_id ?? null;
  const { orgs: memberships, loading } = useOrganizations();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const hasChosenOrg = useOrgStore((s) => s.hasChosenOrg);
  const setActiveOrgId = useOrgStore((s) => s.setActiveOrgId);

  // A selection that no longer resolves (left, rejected, first run) falls back
  // to an organization the viewer can actually work in.
  useEffect(() => {
    if (loading) return;
    const reconciled = reconcileActiveOrgId(memberships, activeOrgId, hasChosenOrg);
    if (reconciled !== activeOrgId) setActiveOrgId(reconciled);
  }, [loading, memberships, activeOrgId, hasChosenOrg, setActiveOrgId]);

  useEffect(() => {
    if (organizationId === null) return;
    useOrgStore.getState().adoptActiveOrg(
      organizationId,
      memberships.map((org) => org.id)
    );
  }, [organizationId, memberships]);
}
