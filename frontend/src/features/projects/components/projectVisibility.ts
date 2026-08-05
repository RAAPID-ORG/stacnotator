import type { ProjectOut } from '~/api/client';

export type ProjectVisibility = ProjectOut['visibility'];

export const LEAVE_PUBLIC_WARNING =
  'Leaving public strips the "anyone" audience from the permissions of every campaign in this project. People outside the project lose their working access.';

/** Leaving platform-public (to organization OR private) strips the "anyone"
 *  audience from campaign policies, so the settings UI must show
 *  LEAVE_PUBLIC_WARNING and get a confirm before updateProject fires. */
export const requiresLeavePublicConfirm = (
  current: ProjectVisibility,
  next: ProjectVisibility
): boolean => current === 'public' && next !== 'public';
