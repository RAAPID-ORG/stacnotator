import { useEffect, useMemo } from 'react';
import { type OrganizationOut } from '~/api/client';
import { useOrganizationsStore } from '../stores/organizations.store';
import { APPROVED } from '../utils/organizations';

export interface UseOrganizations {
  orgs: OrganizationOut[];
  loading: boolean;
  /** Set when the list could not be fetched. An empty `orgs` with an error is a
   *  failure, not a viewer without organizations - the two look identical
   *  otherwise and read very differently to the user. */
  error: string | null;
  refresh: () => Promise<void>;
}

/** The organizations the current user belongs to, with viewer-relative
 *  `is_admin` and `status`. Backed by a shared store: the list is fetched once
 *  and every consumer reads the same items, so a `refresh()` anywhere reaches
 *  all of them. With `approvedOnly`, only organizations that can own projects
 *  are returned - an empty result then means the user cannot create a project
 *  yet. */
export const useOrganizations = (options?: { approvedOnly?: boolean }): UseOrganizations => {
  const approvedOnly = options?.approvedOnly ?? false;
  const items = useOrganizationsStore((s) => s.items);
  const loading = useOrganizationsStore((s) => s.loading);
  const error = useOrganizationsStore((s) => s.error);
  const ensureLoaded = useOrganizationsStore((s) => s.ensureLoaded);
  const refresh = useOrganizationsStore((s) => s.refresh);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const orgs = useMemo(
    () => (approvedOnly ? items.filter((org) => org.status === APPROVED) : items),
    [items, approvedOnly]
  );

  return { orgs, loading, error, refresh };
};
