import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '~/app/providers/AuthProvider';
import { PlatformUsersTable } from '~/features/settings/components/PlatformUsersTable';
import { PlatformOrganizationsTable } from '~/features/settings/components/PlatformOrganizationsTable';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Button, Field, Input } from '~/shared/ui/forms';
import { useLayoutStore } from 'src/shared/stores/layout.store';
import { getOrganizationTilers, type UserOut, type UserOutDetailed } from '~/api/client';
import {
  approveOrganizationMutation,
  editUserInfoMutation,
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
import { useAccountStore } from '~/shared/stores/account.store';
import {
  useOrganizations,
  useRefreshOrganizations,
} from '~/features/organizations/hooks/useOrganizations';
import { pendingAdminActions } from '~/features/organizations/utils/organizations';
import { CountBadge } from '~/shared/ui/Badge';
import { authManager, AUTH_PROVIDERS } from 'src/features/auth/index';
import { usernameError } from 'src/features/auth/utils/usernames';
import {
  authErrorMessage,
  CHANGE_PASSWORD_ERRORS,
} from 'src/features/auth/adapters/firebase/errors';
import {
  PasswordRequirementsList,
  passwordMeetsAllRequirements,
} from 'src/features/auth/ui/PasswordRequirements';
import { FadeIn } from '~/shared/ui/motion';
import { handleError } from '~/shared/utils/errorHandler';

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

export const SettingsPage = () => {
  const navigate = useNavigate();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile' | 'platform'>('profile');

  // Username editing state
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');

  // Change password state
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [_passwordSuccess, setPasswordSuccess] = useState(false);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

  // Use individual selectors to avoid creating new objects on every render
  const account = useAccountStore((s) => s.account);
  const fetchAccount = useAccountStore((s) => s.fetchAccount);
  const isPlatformAdmin = account?.is_admin ?? false;

  // The same list the sidebar switcher reads: for a platform admin it is every
  // organization on the platform, which is what this tab administers. One cache
  // entry means the tab badge is right before the tab is ever opened, and an
  // approval here reads as approved everywhere else immediately.
  const { orgs: knownOrgs, loading: orgsLoading } = useOrganizations();
  const refreshOrganizations = useRefreshOrganizations();

  const usersQuery = useQuery({
    ...listUsersOptions({}),
    enabled: isPlatformAdmin && activeTab === 'platform',
    meta: { errorMessage: 'Failed to load users' },
  });
  const users = useMemo(() => (usersQuery.data ?? []).filter(isDetailedUser), [usersQuery.data]);

  const tilersQuery = useQuery({
    ...listGrantableTilersOptions(),
    enabled: isPlatformAdmin && activeTab === 'platform',
    meta: { errorMessage: 'Failed to load tilers' },
  });

  const refreshOrganizationsTab = () => {
    void refreshOrganizations();
    void queryClient.invalidateQueries({ queryKey: listGrantableTilersQueryKey() });
  };

  useEffect(() => {
    setBreadcrumbs([{ label: 'Settings' }]);
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

  const editUsername = useMutation({
    ...editUserInfoMutation(),
    meta: { errorMessage: 'Failed to update username' },
    onSuccess: async () => {
      await fetchAccount();
      setIsEditingDisplayName(false);
      showAlert('Username updated', 'success');
    },
  });

  const saving = grant.isPending || revoke.isPending || editUsername.isPending || changingPassword;

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

  const handleSaveDisplayName = () => {
    if (!account || !displayNameInput.trim()) return;
    editUsername.mutate({
      path: { user_id: account.id },
      query: { new_display_name: displayNameInput.trim() },
    });
  };

  const emailProvider = authManager.getProvider(AUTH_PROVIDERS.EMAIL);
  const supportsChangePassword = !!emailProvider?.changePassword;

  const newPasswordMeetsRequirements = useMemo(() => {
    return passwordMeetsAllRequirements(newPassword);
  }, [newPassword]);

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(false);

    if (!currentPassword || !newPassword) {
      setPasswordError('Please fill in all fields.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (!newPasswordMeetsRequirements) {
      setPasswordError(
        'Password must be at least 8 characters with uppercase, lowercase, number, and special character.'
      );
      return;
    }

    try {
      setChangingPassword(true);
      await emailProvider!.changePassword!(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setIsChangingPassword(false);
      showAlert('Password changed successfully', 'success');
    } catch (err) {
      setPasswordError(
        authErrorMessage(
          err,
          CHANGE_PASSWORD_ERRORS,
          'Failed to change password. Please try again.'
        )
      );
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.logout();
      navigate('/');
    } catch (err) {
      handleError(err, 'Sign out failed');
    }
  };

  const handleStartEditDisplayName = () => {
    setDisplayNameInput(account?.display_name || '');
    setIsEditingDisplayName(true);
  };

  const handleCancelEditDisplayName = () => {
    setIsEditingDisplayName(false);
    setDisplayNameInput('');
  };

  // AuthGate only renders the app once the account is loaded.
  if (!account) return null;

  const sectionCls =
    'space-y-4 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  return (
    <>
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              <h1 className="page-title">Settings</h1>
              <p className="page-subtitle">Manage your profile and platform settings.</p>
            </div>
          </header>

          <div className="surface">
            {/* Tab nav inset into the surface header */}
            <div className="flex gap-4 px-6 border-b border-neutral-200">
              <button
                onClick={() => setActiveTab('profile')}
                className={`px-1 py-3 border-b-2 transition-colors ${
                  activeTab === 'profile'
                    ? 'border-brand-600 text-brand-700 font-medium'
                    : 'border-transparent text-neutral-500 hover:text-brand-700'
                }`}
                type="button"
              >
                Profile
              </button>
              {isPlatformAdmin && (
                <button
                  onClick={() => setActiveTab('platform')}
                  className={`px-1 py-3 border-b-2 transition-colors ${
                    activeTab === 'platform'
                      ? 'border-brand-600 text-brand-700 font-medium'
                      : 'border-transparent text-neutral-500 hover:text-brand-700'
                  }`}
                  type="button"
                >
                  <span className="inline-flex items-center gap-1.5">
                    Platform
                    <CountBadge
                      count={pendingAdminActions(knownOrgs, account.is_admin).organizationApprovals}
                      label="organizations to review"
                    />
                  </span>
                </button>
              )}
            </div>

            <div className="p-6">
              {/* Tab Content */}
              {activeTab === 'profile' && (
                <div>
                  <section className={sectionCls}>
                    <h2 className="section-heading">Profile information</h2>
                    <div className="space-y-4">
                      <Field label="Email">
                        <Input type="text" value={account.email} disabled />
                      </Field>
                      <Field
                        label="Username"
                        error={isEditingDisplayName ? usernameError(displayNameInput) : undefined}
                      >
                        {isEditingDisplayName ? (
                          <div className="flex gap-2">
                            <Input
                              type="text"
                              value={displayNameInput}
                              onChange={(e) => setDisplayNameInput(e.target.value)}
                              disabled={saving}
                              placeholder="e.g. ada.lovelace"
                              invalid={Boolean(usernameError(displayNameInput))}
                              autoFocus
                            />
                            <Button
                              onClick={handleSaveDisplayName}
                              disabled={saving || Boolean(usernameError(displayNameInput))}
                              leading={
                                saving ? (
                                  <svg
                                    className="w-4 h-4 animate-spin"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                  >
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
                              Save
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={handleCancelEditDisplayName}
                              disabled={saving}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Input
                              type="text"
                              value={account.display_name || ''}
                              disabled
                              placeholder="No username set"
                            />
                            <Button variant="secondary" onClick={handleStartEditDisplayName}>
                              Edit
                            </Button>
                          </div>
                        )}
                      </Field>
                      {account.is_admin && (
                        <Field label="Role">
                          <span className="inline-flex px-3 py-1.5 text-xs font-medium rounded-full bg-brand-100 text-brand-800 border border-brand-200">
                            Administrator
                          </span>
                        </Field>
                      )}
                    </div>
                  </section>

                  {/* Change Password - only for email/password-authenticated users */}
                  {supportsChangePassword && authManager.getActiveProviderId() === 'email' && (
                    <section className={sectionCls}>
                      {!isChangingPassword ? (
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h2 className="section-heading">Change password</h2>
                            <p className="section-description">
                              Update the password you use to sign in.
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setIsChangingPassword(true);
                              setPasswordError(null);
                              setPasswordSuccess(false);
                            }}
                          >
                            Change password
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4 max-w-md">
                          <h2 className="section-heading">Change password</h2>
                          {passwordError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                              {passwordError}
                            </div>
                          )}
                          <Field label="Current password">
                            <Input
                              type="password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              disabled={saving}
                              autoComplete="current-password"
                            />
                          </Field>
                          <Field label="New password">
                            <Input
                              type="password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              disabled={saving}
                              autoComplete="new-password"
                            />
                            <PasswordRequirementsList password={newPassword} />
                          </Field>
                          <Field label="Confirm new password">
                            <Input
                              type="password"
                              value={confirmNewPassword}
                              onChange={(e) => setConfirmNewPassword(e.target.value)}
                              disabled={saving}
                              autoComplete="new-password"
                            />
                          </Field>
                          <div className="flex gap-2">
                            <Button
                              onClick={handleChangePassword}
                              disabled={saving || !newPasswordMeetsRequirements}
                            >
                              {saving ? 'Saving…' : 'Update password'}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setIsChangingPassword(false);
                                setCurrentPassword('');
                                setNewPassword('');
                                setConfirmNewPassword('');
                                setPasswordError(null);
                              }}
                              disabled={saving}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  <section className={sectionCls}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="section-heading">Sign out</h2>
                        <p className="section-description">Ends your session on this device.</p>
                      </div>
                      <Button
                        variant="dangerQuiet"
                        data-testid="sign-out-button"
                        onClick={handleSignOut}
                      >
                        Sign out
                      </Button>
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'platform' && isPlatformAdmin && (
                <div>
                  <section className={sectionCls}>
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

                  <section className={sectionCls}>
                    <div className="flex items-center justify-between">
                      <h2 className="section-heading">
                        Organizations{' '}
                        <span className="text-neutral-400 font-normal">({knownOrgs.length})</span>
                      </h2>
                      <RefreshButton
                        onClick={refreshOrganizationsTab}
                        busy={tilersQuery.isFetching}
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
                </div>
              )}
            </div>
          </div>
        </FadeIn>
      </div>

      <LoadingOverlay visible={saving} text="Processing..." />
    </>
  );
};
