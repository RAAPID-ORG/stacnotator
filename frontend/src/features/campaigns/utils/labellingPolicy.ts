import type { LabellingPolicy, PolicyAudience } from '~/api/client';

// Matches backend/src/campaigns/schemas.py default_labelling_policy(): any
// member can label anything; completion stays with assignees/admins/
// authoritative. Used to seed a new campaign in the wizard.
export const DEFAULT_LABELLING_POLICY: LabellingPolicy = {
  explore: { kinds: ['members'], user_ids: [] },
  unassigned_tasks: { kinds: ['members'], user_ids: [] },
  assigned_tasks: { kinds: ['members'], user_ids: [] },
  complete_assigned: { kinds: ['assignees', 'admins', 'authoritative'], user_ids: [] },
  modify_others: { kinds: ['admins'], user_ids: [] },
};

// complete_assigned is excluded deliberately - 'anyone' isn't a valid kind
// there (backend and the editor both reject it).
const PUBLIC_SEEDED_AXES: (keyof LabellingPolicy)[] = [
  'explore',
  'unassigned_tasks',
  'assigned_tasks',
];

/** Adds the 'anyone' audience to the axes that accept it, mirroring the
 *  backend's default_labelling_policy(is_public=True). The wizard always sends
 *  an explicit policy, so that backend default never fires for a created
 *  campaign - without this a campaign in a public project would be closed to
 *  non-members. The user can still uncheck 'anyone' in the editor. */
export const withAnyoneSeeded = (policy: LabellingPolicy): LabellingPolicy => {
  const seeded = { ...policy };
  for (const axis of PUBLIC_SEEDED_AXES) {
    const current = policy[axis] ?? { kinds: [], user_ids: [] };
    const kinds = new Set(current.kinds ?? []);
    kinds.add('anyone');
    seeded[axis] = { ...current, kinds: Array.from(kinds) };
  }
  return seeded;
};

/** Who the viewer is, as far as any labelling-policy axis is concerned.
 *  isAssigned is per-task, so it is absent when the axis is not task-scoped. */
export interface PolicyContext {
  userId: string | null;
  isAdmin: boolean;
  isAuthoritative: boolean;
  isMember: boolean;
  isAssigned?: boolean;
}

export function isAudienceMember(
  audience: PolicyAudience | undefined,
  ctx: PolicyContext
): boolean {
  const kinds = audience?.kinds ?? [];
  if (kinds.includes('anyone')) return true;
  if (kinds.includes('members') && ctx.isMember) return true;
  if (kinds.includes('admins') && ctx.isAdmin) return true;
  if (kinds.includes('authoritative') && ctx.isAuthoritative) return true;
  if (kinds.includes('assignees') && ctx.isAssigned) return true;
  return ctx.userId != null && (audience?.user_ids ?? []).includes(ctx.userId);
}
