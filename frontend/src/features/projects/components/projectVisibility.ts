import type { ProjectOut } from '~/api/client';
import i18n from '~/shared/i18n';

const t = i18n.getFixedT(null, 'projects');

export type ProjectVisibility = ProjectOut['visibility'];

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
      title: t('visibility.makePublicTitle'),
      description: t('visibility.makePublicWarning'),
      confirmText: t('visibility.makePublic'),
      isDangerous: false,
    };
  }
  if (current === 'public') {
    return {
      title: t('visibility.leavePublicTitle'),
      description: t('visibility.leavePublicWarning'),
      confirmText:
        next === 'organization'
          ? t('visibility.restrictToOrganization')
          : t('visibility.makePrivate'),
      isDangerous: true,
    };
  }
  return null;
};
