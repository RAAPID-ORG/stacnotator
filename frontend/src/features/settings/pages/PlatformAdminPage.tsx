import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '~/shared/ui/Spinner';
import { Navigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlatformUsersTable } from '~/features/settings/components/PlatformUsersTable';
import { PlatformOrganizationsTable } from '~/features/settings/components/PlatformOrganizationsTable';
import { LoadingOverlay } from '~/shared/ui/LoadingOverlay';
import { Button } from '~/shared/ui/forms';
import { useLayoutStore } from '~/shared/stores/layout.store';
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

const RefreshButton = ({ onClick, busy }: { onClick: () => void; busy: boolean }) => {
  const { t } = useTranslation('settings');
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={busy}
      leading={busy ? <Spinner size="xs" /> : undefined}
    >
      {t('refresh')}
    </Button>
  );
};

export const PlatformAdminPage = () => {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const [platformTab, setPlatformTab] = useState<'organizations' | 'users'>('organizations');

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);
  const isPlatformAdmin = useAccountStore((s) => s.account?.is_platform_admin ?? false);

  // The same list the sidebar reads: for a platform admin it is every
  // organization on the platform, which is what this page administers. One cache
  // entry means the badge is right before the page is ever opened, and an
  // approval here reads as approved everywhere else immediately.
  const { orgs: knownOrgs, loading: orgsLoading } = useOrganizations();
  const refreshOrganizations = useRefreshOrganizations();

  const usersQuery = useQuery({
    ...listUsersOptions({}),
    enabled: isPlatformAdmin && platformTab === 'users',
    meta: { errorMessage: t('toasts.loadUsersFailed') },
  });
  const users = useMemo(() => (usersQuery.data ?? []).filter(isDetailedUser), [usersQuery.data]);

  const tilersQuery = useQuery({
    ...listGrantableTilersOptions(),
    enabled: isPlatformAdmin && platformTab === 'organizations',
    meta: { errorMessage: t('toasts.loadTilersFailed') },
  });

  const refreshOrganizationsTab = () => {
    void refreshOrganizations();
    void queryClient.invalidateQueries({ queryKey: listGrantableTilersQueryKey() });
  };

  useEffect(() => {
    setBreadcrumbs([{ label: t('platformAdmin.title') }]);
  }, [setBreadcrumbs, t]);

  const refetchUsers = () => queryClient.invalidateQueries({ queryKey: listUsersQueryKey({}) });

  const grant = useMutation({
    ...grantAdminMutation(),
    meta: reportedByCaller(t('toasts.grantAdminFailed')),
    onSuccess: (result) => {
      void refetchUsers();
      showAlert(t('toasts.adminGranted', { count: result.success.length }), 'success');
    },
  });
  const revoke = useMutation({
    ...revokeAdminMutation(),
    meta: reportedByCaller(t('toasts.revokeAdminFailed')),
    onSuccess: (result) => {
      void refetchUsers();
      showAlert(t('toasts.adminRevoked', { count: result.success.length }), 'success');
    },
  });

  const approve = useMutation({
    ...approveOrganizationMutation(),
    meta: reportedByCaller(t('toasts.approveOrgFailed')),
    onSuccess: refreshOrganizations,
  });
  const reject = useMutation({
    ...rejectOrganizationMutation(),
    meta: reportedByCaller(t('toasts.rejectOrgFailed')),
    onSuccess: refreshOrganizations,
  });
  const internalStorage = useMutation({
    ...updateInternalStorageMutation(),
    meta: reportedByCaller(t('toasts.internalStorageFailed')),
    onSuccess: refreshOrganizations,
  });
  const saveTilers = useMutation({
    ...setOrganizationTilersMutation(),
    meta: reportedByCaller(t('toasts.saveAccessFailed')),
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
    showAlert(t('toasts.orgApproved', { name: organization.name }), 'success');
  };

  const handleRejectOrganization = async (organizationId: number) => {
    const organization = await reject.mutateAsync({
      path: { organization_id: organizationId },
    });
    showAlert(t('toasts.orgRejected', { name: organization.name }), 'success');
  };

  const handleSetInternalStorage = async (organizationId: number, allowed: boolean) => {
    await internalStorage.mutateAsync({
      path: { organization_id: organizationId },
      body: { allows_internal_storage: allowed },
    });
    showAlert(t('toasts.internalStorageUpdated'), 'success');
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
    showAlert(t('toasts.tileAccessUpdated'), 'success');
  };

  const approvals = pendingAdminActions(knownOrgs, true).organizationApprovals;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              <h1 className="page-title">{t('platformAdmin.title')}</h1>
              <p className="page-subtitle">{t('platformAdmin.subtitle')}</p>
            </div>
          </header>

          <div className="surface">
            <TabNavigator
              items={[
                {
                  id: 'organizations',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {t('tabs.organizations')}
                      <CountBadge count={approvals} label={t('tabs.organizationsToReview')} />
                    </span>
                  ),
                },
                { id: 'users', label: t('tabs.users') },
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
                      <Trans
                        t={t}
                        i18nKey="platform.usersHeading"
                        values={{ count: users.length }}
                        components={{ count: <span className="text-neutral-400 font-normal" /> }}
                      />
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
                      <Trans
                        t={t}
                        i18nKey="platform.organizationsHeading"
                        values={{ count: knownOrgs.length }}
                        components={{ count: <span className="text-neutral-400 font-normal" /> }}
                      />
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

      <LoadingOverlay visible={grant.isPending || revoke.isPending} text={t('processing')} />
    </>
  );
};
