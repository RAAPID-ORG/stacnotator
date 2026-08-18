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
