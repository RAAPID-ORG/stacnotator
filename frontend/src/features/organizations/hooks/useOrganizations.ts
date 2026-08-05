import { useCallback, useEffect, useState } from 'react';
import { listOrganizations, type OrganizationOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';

export interface UseOrganizations {
  orgs: OrganizationOut[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/** The organizations the current user belongs to, with viewer-relative
 *  `is_admin` and `status`. Fetched once on mount. */
export const useOrganizations = (): UseOrganizations => {
  const [orgs, setOrgs] = useState<OrganizationOut[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listOrganizations();
      setOrgs(data?.items ?? []);
    } catch (err) {
      handleError(err, 'Failed to load organizations', { showUser: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { orgs, loading, refresh };
};
