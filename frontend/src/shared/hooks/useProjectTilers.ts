import { useEffect, useState } from 'react';
import { getProjectTilers, type TilerOption } from '~/api/client';

export interface ProjectTilers {
  tilers: TilerOption[];
  /** Whether the owning organization may point imagery at managed-identity storage. */
  allowsInternalStorage: boolean;
}

const EMPTY: ProjectTilers = { tilers: [], allowsInternalStorage: false };

/** Tiler allowlist and internal-storage capability of the project being configured.
 *  Failures degrade to the empty allowlist rather than blocking the editor. */
export const useProjectTilers = (projectId: number): ProjectTilers => {
  const [value, setValue] = useState<ProjectTilers>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    getProjectTilers({ path: { project_id: projectId } })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setValue({ tilers: data.tilers, allowsInternalStorage: data.allows_internal_storage });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return value;
};
