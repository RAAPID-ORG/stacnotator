export const APPROVED = 'approved';

type SelectableOrg = { id: number; status: string };

/** Keeps the persisted org selection honest: an id that is no longer in the
 *  viewer's list (org deleted, access revoked) falls back to the first approved
 *  org, since only those can own projects - landing someone in a pending org
 *  gives them a workspace nothing can be created in. No approved org means no
 *  selection. An explicit "no organization" (null) is a real choice and is left
 *  alone, as is an id still in the list whatever its status. */
export const reconcileActiveOrgId = (
  orgs: SelectableOrg[],
  activeOrgId: number | null
): number | null => {
  if (activeOrgId === null || orgs.some((org) => org.id === activeOrgId)) return activeOrgId;
  return orgs.find((org) => org.status === APPROVED)?.id ?? null;
};
