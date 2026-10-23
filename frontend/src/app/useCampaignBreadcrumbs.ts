import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { campaignPath, projectPath, projectsPath } from '~/app/routes';
import { useProject } from '~/app/projectRoute';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';

/** The one breadcrumb trail for campaign-level pages:
 *  Projects > project > campaign [> subpage]. */
export function useCampaignBreadcrumbs(
  projectId: number,
  campaignId: number,
  campaignName: string | undefined,
  subpage?: string
) {
  const { t } = useTranslation();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const projectName = useProject(projectId).project?.name ?? null;

  useEffect(() => {
    if (!campaignName) return;
    setBreadcrumbs([
      { label: t('nav.projects'), path: projectsPath() },
      {
        label: projectName ? capitalizeFirst(projectName) : t('nav.project'),
        path: projectPath(projectId),
      },
      { label: capitalizeFirst(campaignName), path: campaignPath(projectId, campaignId) },
      ...(subpage ? [{ label: subpage }] : []),
    ]);
  }, [projectId, campaignId, campaignName, projectName, subpage, setBreadcrumbs, t]);
}
