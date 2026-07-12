import type { PolicyAudience } from '~/api/client';

// Mirrors backend.src.campaigns.policy.is_allowed / PolicyContext. `isAssigned`
// is optional and defaults to falsy: task-independent call sites (e.g.
// `explore`) simply never pass it, so the `assignees` kind - meaningful only
// for the two assigned-task axes - falls through to the explicit user_ids
// check, same as it would with is_assigned=false server-side. Task-scoped
// call sites (assigned_tasks / complete_assigned) pass whether the current
// user has any assignment on the task at hand.
export interface PolicyContext {
  userId: string | null;
  isAdmin: boolean;
  isAuthoritative: boolean;
  isMember: boolean;
  isAssigned?: boolean;
}

export const isAudienceMember = (
  audience: PolicyAudience | undefined,
  ctx: PolicyContext
): boolean => {
  const kinds = audience?.kinds ?? [];
  const userIds = audience?.user_ids ?? [];

  if (kinds.includes('anyone')) return true;
  if (kinds.includes('members') && ctx.isMember) return true;
  if (kinds.includes('admins') && ctx.isAdmin) return true;
  if (kinds.includes('authoritative') && ctx.isAuthoritative) return true;
  if (kinds.includes('assignees') && ctx.isAssigned) return true;
  return ctx.userId != null && userIds.includes(ctx.userId);
};
