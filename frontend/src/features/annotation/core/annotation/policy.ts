import type { PolicyAudience } from '~/api/client';

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
