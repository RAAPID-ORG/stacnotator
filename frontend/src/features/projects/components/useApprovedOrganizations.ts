import { useEffect, useState } from 'react';
import { listOrganizations, type OrganizationOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';

const APPROVED = 'approved';

/** Approved organizations the user belongs to (platform admins get all of
 *  them). Membership is implied by presence in the list, so an empty result
 *  means the user cannot own a project yet. */
export const useApprovedOrganizations = () => {
  const [organizations, setOrganizations] = useState<OrganizationOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchOrganizations = async () => {
      try {
        const { data } = await listOrganizations();
        if (cancelled) return;
        setOrganizations((data?.items ?? []).filter((org) => org.status === APPROVED));
      } catch (err) {
        handleError(err, 'Failed to load organizations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOrganizations();

    return () => {
      cancelled = true;
    };
  }, []);

  return { organizations, loading };
};
