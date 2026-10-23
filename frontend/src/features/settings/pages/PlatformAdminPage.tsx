import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlatformUsersTable } from '~/features/settings/components/PlatformUsersTable';
import { PlatformOrganizationsTable } from '~/features/settings/components/PlatformOrganizationsTable';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Button } from '~/shared/ui/forms';
import { useLayoutStore } from 'src/shared/stores/layout.store';
import { getOrganizationTilers, type UserOut, type UserOutDetailed } from '~/api/client';
import {
  approveOrganizationMutation,
  grantAdminMutation,
  listGrantableTilersOptions,
  listGrantableTilersQueryKey,
  listUsersOptions,
  listUsersQueryKey,
  rejectOrganizationMutation,
  revokeAdminMutation,
  setOrganizationTilersMutation,
  updateInternalStorageMutation,
} from '~/api/queries';
import { reportedByCaller } from '~/api/queryClient';
import { settingsPath } from '~/app/routes';
import { useAccountStore } from '~/shared/stores/account.store';
import {
  useOrganizations,
  useRefreshOrganizations,
} from '~/features/organizations/hooks/useOrganizations';
import { pendingAdminActions } from '~/features/organizations/utils/organizations';
import { CountBadge } from '~/shared/ui/Badge';
import { TabNavigator } from '~/shared/ui/TabNavigator';
import { FadeIn } from '~/shared/ui/motion';

const NO_TILERS: string[] = [];

/** /auth/users returns the detailed shape only to platform admins. */
const isDetailedUser = (user: UserOut | UserOutDetailed): user is UserOutDetailed =>
  'is_admin' in user;

const RefreshButton = ({ onClick, busy }: { onClick: () => void; busy: boolean }) => (
  <Button
    variant="secondary"
    onClick={onClick}
    disabled={busy}
    leading={
      busy ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : undefined
    }
  >
    Refresh
  </Button>
);

export const PlatformAdminPage = () => {
  const queryClient = useQueryClient();
  const [platformTab, setPlatformTab] = useState<'organizations' | 'users'>('organizations');

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);
  const isPlatformAdmin = useAccountStore((s) => s.account?.is_admin ?? false);

  // The same list the sidebar reads: for a platform admin it is every
  // organization on the platform, which is what this page administers. One cache
  // entry means the badge is right before the page is ever opened, and an
  // approval here reads as approved everywhere else immediately.
  const { orgs: knownOrgs, loading: orgsLoading } = useOrganizations();
  const refreshOrganizations = useRefreshOrganizations();

  const usersQuery = useQuery({
    ...listUsersOptions({}),
    enabled: isPlatformAdmin && platformTab === 'users',
    meta: { errorMessage: 'Failed to load users' },
  });
  const users = useMemo(() => (usersQuery.data ?? []).filter(isDetailedUser), [usersQuery.data]);

  const tilersQuery = useQuery({
    ...listGrantableTilersOptions(),
    enabled: isPlatformAdmin && platformTab === 'organizations',
    meta: { errorMessage: 'Failed to load tilers' },
  });

  const refreshOrganizationsTab = () => {
    void refreshOrganizations();
    void queryClient.invalidateQueries({ queryKey: listGrantableTilersQueryKey() });
  };

  useEffect(() => {
    setBreadcrumbs([{ label: 'Platform admin' }]);
  }, [setBreadcrumbs]);

  const refetchUsers = () => queryClient.invalidateQueries({ queryKey: listUsersQueryKey({}) });

  const grant = useMutation({
    ...grantAdminMutation(),
    meta: reportedByCaller('Failed to grant admin'),
    onSuccess: (result) => {
      void refetchUsers();
      showAlert(`${result.success.length} user(s) granted admin successfully`, 'success');
    },
  });
  const revoke = useMutation({
    ...revokeAdminMutation(),
    meta: reportedByCaller('Failed to revoke admin'),
    onSuccess: (result) => {
      void refetchUsers();
      showAlert(`${result.success.length} admin role(s) revoked successfully`, 'success');
    },
  });

  const approve = useMutation({
    ...approveOrganizationMutation(),
    meta: reportedByCaller('Failed to approve organization'),
    onSuccess: refreshOrganizations,
  });
  const reject = useMutation({
    ...rejectOrganizationMutation(),
    meta: reportedByCaller('Failed to reject organization'),
    onSuccess: refreshOrganizations,
  });
  const internalStorage = useMutation({
    ...updateInternalStorageMutation(),
    meta: reportedByCaller('Failed to update internal storage'),
    onSuccess: refreshOrganizations,
  });
  const saveTilers = useMutation({
    ...setOrganizationTilersMutation(),
    meta: reportedByCaller('Failed to save organization access'),
  });

  if (!isPlatformAdmin) return <Navigate to={settingsPath()} replace />;

  const handleGrantAdmin = async (userIds: string[]) => {
    await grant.mutateAsync({ body: { user_ids: userIds } });
  };
  const handleRevokeAdmin = async (userIds: string[]) => {
    await revoke.mutateAsync({ body: { user_ids: userIds } });
  };

  const handleApproveOrganization = async (organizationId: number) => {
    const organization = await approve.mutateAsync({
      path: { organization_id: organizationId },
    });
    showAlert(`Organization '${organization.name}' approved`, 'success');
  };

  const handleRejectOrganization = async (organizationId: number) => {
    const organization = await reject.mutateAsync({
      path: { organization_id: organizationId },
    });
    showAlert(`Organization '${organization.name}' rejected`, 'success');
  };

  const handleSetInternalStorage = async (organizationId: number, allowed: boolean) => {
    await internalStorage.mutateAsync({
      path: { organization_id: organizationId },
      body: { allows_internal_storage: allowed },
    });
    showAlert('Internal storage updated', 'success');
  };

  // An imperative read for one expanded row, not page state, so it stays a
  // plain call rather than a query nobody else shares.
  const handleLoadOrganizationTilers = async (organizationId: number) => {
    const { data } = await getOrganizationTilers({
      path: { organization_id: organizationId },
      throwOnError: true,
    });
    return data.tiler_names;
  };

  const handleSaveOrganizationTilers = async (organizationId: number, tilerNames: string[]) => {
    await saveTilers.mutateAsync({
      path: { organization_id: organizationId },
      body: { tiler_names: tilerNames },
    });
    showAlert('Tile access updated', 'success');
  };

  const approvals = pendingAdminActions(knownOrgs, true).organizationApprovals;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              <h1 className="page-title">Platform admin</h1>
              <p className="page-subtitle">
                Approve organizations and manage platform administrators.
              </p>
            </div>
          </header>

          <div className="surface">
            <TabNavigator
              items={[
                {
                  id: 'organizations',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Organizations
                      <CountBadge count={approvals} label="organizations to review" />
                    </span>
                  ),
                },
                { id: 'users', label: 'Users' },
              ]}
              activeId={platformTab}
              onChange={setPlatformTab}
              className="!mb-0 !border-neutral-200 px-6"
            />
            <div className="p-6">
              {platformTab === 'users' && (
                <section id="tab-users" role="tabpanel" className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="section-heading">
                      Platform users{' '}
                      <span className="text-neutral-400 font-normal">({users.length})</span>
                    </h2>
                    <RefreshButton onClick={refetchUsers} busy={usersQuery.isFetching} />
                  </div>
                  <PlatformUsersTable
                    users={users}
                    onGrantAdmin={handleGrantAdmin}
                    onRevokeAdmin={handleRevokeAdmin}
                    loading={usersQuery.isPending}
                  />
                </section>
              )}

              {platformTab === 'organizations' && (
                <section id="tab-organizations" role="tabpanel" className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="section-heading">
                      Organizations{' '}
                      <span className="text-neutral-400 font-normal">({knownOrgs.length})</span>
                    </h2>
                    <RefreshButton
                      onClick={refreshOrganizationsTab}
                      busy={orgsLoading || tilersQuery.isFetching}
                    />
                  </div>
                  <PlatformOrganizationsTable
                    organizations={knownOrgs}
                    allTilers={tilersQuery.data ?? NO_TILERS}
                    onApprove={handleApproveOrganization}
                    onReject={handleRejectOrganization}
                    onSetInternalStorage={handleSetInternalStorage}
                    onLoadTilers={handleLoadOrganizationTilers}
                    onSaveTilers={handleSaveOrganizationTilers}
                    loading={orgsLoading || tilersQuery.isPending}
                  />
                </section>
              )}
            </div>
          </div>
        </FadeIn>
      </div>

      <LoadingOverlay visible={grant.isPending || revoke.isPending} text="Processing..." />
    </>
  );
};
