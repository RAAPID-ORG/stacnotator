import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type TilerOption } from '~/api/client';
import { getProjectTilersOptions } from '~/api/queries';

export interface ProjectTilers {
  tilers: TilerOption[];
  /** Whether the owning organization may point imagery at managed-identity storage. */
  allowsInternalStorage: boolean;
}

const EMPTY: ProjectTilers = { tilers: [], allowsInternalStorage: false };

/** Tiler allowlist and internal-storage capability of the project being configured.
 *  Failures degrade to the empty allowlist rather than blocking the editor. */
export const useProjectTilers = (projectId: number): ProjectTilers => {
  const { t } = useTranslation();
  const { data } = useQuery({
    ...getProjectTilersOptions({ path: { project_id: projectId } }),
    meta: { errorMessage: t('errors.loadProjectTilers'), showUser: false },
  });

  if (!data) return EMPTY;
  return { tilers: data.tilers, allowsInternalStorage: data.allows_internal_storage };
};
