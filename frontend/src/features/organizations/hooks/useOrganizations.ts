import { useCallback, useEffect, useState } from 'react';
import { listOrganizations, type OrganizationOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';

export interface UseOrganizations {
  orgs: OrganizationOut[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const APPROVED = 'approved';

/** The organizations the current user belongs to, with viewer-relative
 *  `is_admin` and `status`. Fetched once on mount. With `approvedOnly`, only
 *  organizations that can own projects are returned - an empty result then
 *  means the user cannot create a project yet. */
export const useOrganizations = (options?: { approvedOnly?: boolean }): UseOrganizations => {
  const approvedOnly = options?.approvedOnly ?? false;
  const [orgs, setOrgs] = useState<OrganizationOut[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listOrganizations();
      const items = data?.items ?? [];
      setOrgs(approvedOnly ? items.filter((org) => org.status === APPROVED) : items);
    } catch (err) {
      handleError(err, 'Failed to load organizations', { showUser: false });
    } finally {
      setLoading(false);
    }
  }, [approvedOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { orgs, loading, refresh };
};
