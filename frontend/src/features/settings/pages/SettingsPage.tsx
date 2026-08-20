import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '~/app/providers/AuthProvider';
import { PlatformUsersTable } from '~/features/settings/components/PlatformUsersTable';
import { PlatformOrganizationsTable } from '~/features/settings/components/PlatformOrganizationsTable';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Button, Field, Input } from '~/shared/ui/forms';
import { useLayoutStore } from 'src/shared/stores/layout.store';
import {
  listUsers,
  grantAdmin,
  revokeAdmin,
  editUserInfo,
  listGrantableTilers,
  listOrganizations,
  approveOrganization,
  rejectOrganization,
  updateInternalStorage,
  getOrganizationTilers,
  setOrganizationTilers,
  type OrganizationOut,
  type UserOut,
  type UserOutDetailed,
} from '~/api/client';
import { useAccountStore } from '~/shared/stores/account.store';
import { useOrganizationsStore } from '~/features/organizations/stores/organizations.store';
import { useOrganizations } from '~/features/organizations/hooks/useOrganizations';
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
  const [activeTab, setActiveTab] = useState<'profile' | 'users' | 'organizations'>('profile');
  const [users, setUsers] = useState<UserOutDetailed[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationOut[]>([]);
  const [allTilers, setAllTilers] = useState<string[]>([]);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Username editing state
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');

  // Change password state
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [_passwordSuccess, setPasswordSuccess] = useState(false);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

  // Use individual selectors to avoid creating new objects on every render
  const account = useAccountStore((s) => s.account);
  const fetchAccount = useAccountStore((s) => s.fetchAccount);
  // Read from the shared list, not this page's: the tab badge has to be right
  // before anyone opens the tab that fetches its own copy.
  const { orgs: knownOrgs } = useOrganizations();

  // Set breadcrumbs
  useEffect(() => {
    setBreadcrumbs([{ label: 'Settings' }]);
  }, [setBreadcrumbs]);

  // Load admin-tab data on first visit to each tab
  useEffect(() => {
    if (!account?.is_admin) return;
    if (activeTab === 'users' && users.length === 0) loadUsers();
    if (activeTab === 'organizations' && organizations.length === 0) loadOrganizations();
  }, [activeTab, account, users.length, organizations.length]);

  const loadUsers = async () => {
    try {
      setIsPageLoading(true);
      const { data } = await listUsers({ throwOnError: true });
      const listed: Array<UserOut | UserOutDetailed> = data;
      setUsers(listed.filter(isDetailedUser));
    } catch (err) {
      handleError(err, 'Failed to load users');
    } finally {
      setIsPageLoading(false);
    }
  };

  const loadOrganizations = async () => {
    try {
      setIsPageLoading(true);
      const [orgsRes, tilersRes] = await Promise.all([
        listOrganizations({ throwOnError: true }),
        listGrantableTilers({ throwOnError: true }),
      ]);
      setOrganizations(orgsRes.data.items);
      setAllTilers(tilersRes.data);
    } catch (err) {
      handleError(err, 'Failed to load organizations');
    } finally {
      setIsPageLoading(false);
    }
  };

  const handleGrantAdmin = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await grantAdmin({
        body: { user_ids: userIds },
      });

      setUsers((prevUsers) =>
        prevUsers.map((user) => {
          const updated = data?.success.find((u) => u.id === user.id);
          return updated || user;
        })
      );

      showAlert(`${data?.success.length || 0} user(s) granted admin successfully`, 'success');
    } catch (err) {
      handleError(err, 'Failed to grant admin');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeAdmin = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await revokeAdmin({
        body: { user_ids: userIds },
      });

      setUsers((prevUsers) =>
        prevUsers.map((user) => {
          const updated = data?.success.find((u) => u.id === user.id);
          return updated || user;
        })
      );

      showAlert(`${data?.success.length || 0} admin role(s) revoked successfully`, 'success');
    } catch (err) {
      handleError(err, 'Failed to revoke admin');
    } finally {
      setSaving(false);
    }
  };

  // Org handlers let failures propagate: PlatformOrganizationsTable reports them
  // and keeps the row's busy/editor state consistent.
  // The shared store is refreshed alongside this page's own copy: approving an
  // organization changes how it reads everywhere else - the sidebar switcher
  // would otherwise keep calling it pending until the next reload.
  const applyOrganization = (updated: OrganizationOut) => {
    setOrganizations((prev) => prev.map((org) => (org.id === updated.id ? updated : org)));
    void useOrganizationsStore.getState().refresh();
  };

  const handleApproveOrganization = async (organizationId: number) => {
    const { data } = await approveOrganization({
      path: { organization_id: organizationId },
      throwOnError: true,
    });
    applyOrganization(data);
    showAlert(`Organization '${data.name}' approved`, 'success');
  };

  const handleRejectOrganization = async (organizationId: number) => {
    const { data } = await rejectOrganization({
      path: { organization_id: organizationId },
      throwOnError: true,
    });
    applyOrganization(data);
    showAlert(`Organization '${data.name}' rejected`, 'success');
  };

  const handleSetInternalStorage = async (organizationId: number, allowed: boolean) => {
    const { data } = await updateInternalStorage({
      path: { organization_id: organizationId },
      body: { allows_internal_storage: allowed },
      throwOnError: true,
    });
    applyOrganization(data);
    showAlert('Internal storage updated', 'success');
  };

  const handleLoadOrganizationTilers = async (organizationId: number) => {
    const { data } = await getOrganizationTilers({
      path: { organization_id: organizationId },
      throwOnError: true,
    });
    return data.tiler_names;
  };

  const handleSaveOrganizationTilers = async (organizationId: number, tilerNames: string[]) => {
    await setOrganizationTilers({
      path: { organization_id: organizationId },
      body: { tiler_names: tilerNames },
      throwOnError: true,
    });
    showAlert('Tile access updated', 'success');
  };

  const handleSaveDisplayName = async () => {
    if (!account || !displayNameInput.trim()) return;

    try {
      setSaving(true);
      const { data } = await editUserInfo({
        path: { user_id: account.id },
        query: { new_display_name: displayNameInput.trim() },
      });

      if (data) {
        await fetchAccount();
        setIsEditingDisplayName(false);
        showAlert('Username updated', 'success');
      }
    } catch (err) {
      handleError(err, 'Failed to update username');
    } finally {
      setSaving(false);
    }
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
      setSaving(true);
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
      setSaving(false);
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
              {account.is_admin && (
                <>
                  <button
                    onClick={() => setActiveTab('users')}
                    className={`px-1 py-3 border-b-2 transition-colors ${
                      activeTab === 'users'
                        ? 'border-brand-600 text-brand-700 font-medium'
                        : 'border-transparent text-neutral-500 hover:text-brand-700'
                    }`}
                    type="button"
                  >
                    User management
                  </button>
                  <button
                    onClick={() => setActiveTab('organizations')}
                    className={`px-1 py-3 border-b-2 transition-colors ${
                      activeTab === 'organizations'
                        ? 'border-brand-600 text-brand-700 font-medium'
                        : 'border-transparent text-neutral-500 hover:text-brand-700'
                    }`}
                    type="button"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      Organizations
                      <CountBadge
                        count={
                          pendingAdminActions(knownOrgs, account.is_admin).organizationApprovals
                        }
                        label="organizations to review"
                      />
                    </span>
                  </button>
                </>
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

              {activeTab === 'users' && account.is_admin && (
                <section className={sectionCls}>
                  <div className="flex items-center justify-between">
                    <h2 className="section-heading">
                      Platform users{' '}
                      <span className="text-neutral-400 font-normal">({users.length})</span>
                    </h2>
                    <RefreshButton onClick={loadUsers} busy={isPageLoading} />
                  </div>
                  <PlatformUsersTable
                    users={users}
                    onGrantAdmin={handleGrantAdmin}
                    onRevokeAdmin={handleRevokeAdmin}
                    loading={isPageLoading}
                  />
                </section>
              )}

              {activeTab === 'organizations' && account.is_admin && (
                <section className={sectionCls}>
                  <div className="flex items-center justify-between">
                    <h2 className="section-heading">
                      Organizations{' '}
                      <span className="text-neutral-400 font-normal">({organizations.length})</span>
                    </h2>
                    <RefreshButton onClick={loadOrganizations} busy={isPageLoading} />
                  </div>
                  <PlatformOrganizationsTable
                    organizations={organizations}
                    allTilers={allTilers}
                    onApprove={handleApproveOrganization}
                    onReject={handleRejectOrganization}
                    onSetInternalStorage={handleSetInternalStorage}
                    onLoadTilers={handleLoadOrganizationTilers}
                    onSaveTilers={handleSaveOrganizationTilers}
                    loading={isPageLoading}
                  />
                </section>
              )}
            </div>
          </div>
        </FadeIn>
      </div>

      <LoadingOverlay visible={saving} text="Processing..." />
    </>
  );
};
