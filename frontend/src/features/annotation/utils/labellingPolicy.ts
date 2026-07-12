import type { PolicyAudience } from '~/api/client';

// Mirrors backend.src.campaigns.policy.is_allowed / PolicyContext. Deliberately
// omits is_assigned: every call site here evaluates a task-independent axis
// (currently just `explore`), so the `assignees` kind - meaningful only for
// the two assigned-task axes - never matches and falls through to the
// explicit user_ids check, same as it would with is_assigned=false server-side.
export interface PolicyContext {
  userId: string | null;
  isAdmin: boolean;
  isAuthoritative: boolean;
  isMember: boolean;
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
  return ctx.userId != null && userIds.includes(ctx.userId);
};
