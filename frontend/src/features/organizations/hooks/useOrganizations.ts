import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type OrganizationOut } from '~/api/client';
import { listOrganizationsOptions, listOrganizationsQueryKey } from '~/api/queries';
import { APPROVED } from '../utils/organizations';

const NO_ORGS: OrganizationOut[] = [];

/** One cache entry for the viewer's organizations, shared by every consumer, so
 *  the sidebar switcher and the pages can never disagree about the list. The
 *  surfaces render their own failure, hence no toast. */
const organizationsQuery = () => ({
  ...listOrganizationsOptions(),
  meta: { errorMessage: 'Failed to load organizations', showUser: false },
});

/** The organizations the current user belongs to, with viewer-relative
 *  `is_admin` and `status`. With `approvedOnly`, only organizations that can own
 *  projects are returned - an empty result then means the user cannot create a
 *  project yet. */
export const useOrganizations = (options?: { approvedOnly?: boolean }) => {
  const approvedOnly = options?.approvedOnly ?? false;
  const { data, isPending, error } = useQuery(organizationsQuery());
  const items = data?.items ?? NO_ORGS;

  const orgs = useMemo(
    () => (approvedOnly ? items.filter((org) => org.status === APPROVED) : items),
    [items, approvedOnly]
  );

  return { orgs, loading: isPending, error };
};

/** For anything that changes the viewer's membership or an organization's own
 *  state - the list carries both, plus the pending counts the badges read. */
export const useRefreshOrganizations = () => {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: listOrganizationsQueryKey() }),
    [queryClient]
  );
};
