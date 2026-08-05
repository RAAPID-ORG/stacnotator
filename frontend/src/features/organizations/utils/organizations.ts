/** Keeps the persisted org selection honest: an id that is no longer in the
 *  viewer's list (org deleted, access revoked) falls back to the first
 *  available org. An explicit "no organization" (null) is a real choice and
 *  is left alone. */
export const reconcileActiveOrgId = (
  orgIds: number[],
  activeOrgId: number | null
): number | null => {
  if (activeOrgId === null || orgIds.includes(activeOrgId)) return activeOrgId;
  return orgIds[0] ?? null;
};
