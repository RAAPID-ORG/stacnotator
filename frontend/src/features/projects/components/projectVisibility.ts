import type { ProjectOut } from '~/api/client';

export type ProjectVisibility = ProjectOut['visibility'];

export const MAKE_PUBLIC_WARNING =
  'Anyone signed in to the platform will be able to open this project and work on its campaigns.';

export const LEAVE_PUBLIC_WARNING =
  'Leaving public strips the "anyone" audience from the permissions of every campaign in this project. People outside the project lose their working access.';

export interface VisibilityConfirm {
  title: string;
  description: string;
  confirmText: string;
  /** Leave-public is destructive (audiences are stripped); make-public is not. */
  isDangerous: boolean;
}

/** Dialog copy for visibility switches that need an explicit confirm before
 *  updateProject fires: opening the project up to the whole platform, or
 *  leaving public (which strips the "anyone" audience from campaign policies).
 *  Returns null for switches that can apply directly. */
export const visibilityConfirm = (
  current: ProjectVisibility,
  next: ProjectVisibility
): VisibilityConfirm | null => {
  if (next === current) return null;
  if (next === 'public') {
    return {
      title: 'Make this project public?',
      description: MAKE_PUBLIC_WARNING,
      confirmText: 'Make public',
      isDangerous: false,
    };
  }
  if (current === 'public') {
    return {
      title: 'Leave public visibility?',
      description: LEAVE_PUBLIC_WARNING,
      confirmText: next === 'organization' ? 'Restrict to organization' : 'Make private',
      isDangerous: true,
    };
  }
  return null;
};
