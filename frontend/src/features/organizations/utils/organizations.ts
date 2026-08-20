export const APPROVED = 'approved';

type SelectableOrg = { id: number; status: string };

/** Keeps the persisted org selection honest. An id that is no longer in the
 *  viewer's list (org deleted, access revoked) falls back to the first
 *  approved org, since only those can own projects - landing someone in a
 *  pending org gives them a workspace nothing can be created in. A null
 *  selection depends on `hasChosenOrg`: a session that never chose defaults to
 *  the first approved org so members start inside their workspace, while a
 *  deliberate "No organization" pick is left alone. An id still in the list is
 *  kept whatever its status. No approved org means no selection. */
export const reconcileActiveOrgId = (
  orgs: SelectableOrg[],
  activeOrgId: number | null,
  hasChosenOrg: boolean
): number | null => {
  const firstApproved = () => orgs.find((org) => org.status === APPROVED)?.id ?? null;
  if (activeOrgId === null) return hasChosenOrg ? null : firstApproved();
  if (orgs.some((org) => org.id === activeOrgId)) return activeOrgId;
  return firstApproved();
};

type PendingSource = { status: string; is_admin?: boolean; pending_access_requests?: number };

/** What is waiting on this viewer as an admin: people asking to join an
 *  organization they administer, plus - for platform admins - organizations
 *  waiting to be approved. Drives the badge on the settings button, which is
 *  where both queues are reachable from. */
export const pendingAdminActions = (orgs: PendingSource[], isPlatformAdmin: boolean) => {
  const accessRequests = orgs.reduce((sum, org) => sum + (org.pending_access_requests ?? 0), 0);
  const organizationApprovals = isPlatformAdmin
    ? orgs.filter((org) => org.status === 'pending').length
    : 0;
  return { accessRequests, organizationApprovals, total: accessRequests + organizationApprovals };
};
