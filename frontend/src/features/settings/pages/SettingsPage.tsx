import { useEffect, useMemo, useState } from 'react';
import { PlatformUsersTable } from '~/features/settings/components/PlatformUsersTable';
import { LoadingSpinner } from 'src/shared/ui/LoadingSpinner';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Button, Field, Input } from '~/shared/ui/forms';
import { useLayoutStore } from 'src/features/layout/layout.store';
import {
  listUsers,
  approveUsersBulk,
  revokeUsersBulk,
  denyUsersBulk,
  grantAdmin,
  revokeAdmin,
  editUserInfo,
  type UserOutDetailed,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { authManager, AUTH_PROVIDERS } from 'src/features/auth/index';
import {
  PasswordRequirementsList,
  passwordMeetsAllRequirements,
} from 'src/features/auth/ui/PasswordRequirements';
import { FadeIn } from '~/shared/ui/motion';
import { handleError } from '~/shared/utils/errorHandler';

export const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState<'profile' | 'users'>('profile');
  const [users, setUsers] = useState<UserOutDetailed[]>([]);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Display name editing state
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

  // Fetch account on mount if not already loaded
  useEffect(() => {
    if (!account) {
      fetchAccount();
    }
  }, [account, fetchAccount]);

  // Set breadcrumbs
  useEffect(() => {
    setBreadcrumbs([{ label: 'Settings' }]);
  }, [setBreadcrumbs]);

  // Load users when switching to users tab (if admin)
  useEffect(() => {
    if (activeTab === 'users' && account?.is_admin && users.length === 0) {
      loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadUsers is a stable callback
  }, [activeTab, account, users.length]);

  const loadUsers = async () => {
    try {
      setIsPageLoading(true);
      const { data } = await listUsers();
      setUsers(data as UserOutDetailed[]);
    } catch (err) {
      handleError(err, 'Failed to load users');
    } finally {
      setIsPageLoading(false);
    }
  };

  const handleApprove = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await approveUsersBulk({
        body: { user_ids: userIds },
      });

      // Update local state
      setUsers((prevUsers) =>
        prevUsers.map((user) => {
          const updated = data?.success.find((u) => u.id === user.id);
          return updated || user;
        })
      );

      showAlert(`${data?.success.length || 0} user(s) approved successfully`, 'success');
    } catch (err) {
      handleError(err, 'Failed to approve users');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await revokeUsersBulk({
        body: { user_ids: userIds },
      });

      // Update local state
      setUsers((prevUsers) =>
        prevUsers.map((user) => {
          const updated = data?.success.find((u) => u.id === user.id);
          return updated || user;
        })
      );

      showAlert(`${data?.success.length || 0} user approval(s) revoked successfully`, 'success');
    } catch (err) {
      handleError(err, 'Failed to revoke user approvals');
    } finally {
      setSaving(false);
    }
  };

  const handleDeny = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await denyUsersBulk({
        body: { user_ids: userIds },
      });

      // Remove denied users from local state
      setUsers((prevUsers) =>
        prevUsers.filter((user) => !data?.success.some((u) => u.id === user.id))
      );

      showAlert(`${data?.success.length || 0} user(s) denied successfully`, 'success');
    } catch (err) {
      handleError(err, 'Failed to deny users');
    } finally {
      setSaving(false);
    }
  };

  const handleGrantAdmin = async (userIds: string[]) => {
    try {
      setSaving(true);
      const { data } = await grantAdmin({
        body: { user_ids: userIds },
      });

      // Update local state
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

      // Update local state
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
        showAlert('Display name updated successfully', 'success');
      }
    } catch (err) {
      handleError(err, 'Failed to update display name');
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
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('auth/wrong-password') || msg.includes('auth/invalid-credential')) {
        setPasswordError('Current password is incorrect.');
      } else if (msg.includes('auth/weak-password')) {
        setPasswordError('New password is too weak.');
      } else {
        setPasswordError('Failed to change password. Please try again.');
      }
    } finally {
      setSaving(false);
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

  // Show loading state while account is being fetched
  if (!account) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading settings..." />
      </div>
    );
  }

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
                      <Field label="Display name">
                        {isEditingDisplayName ? (
                          <div className="flex gap-2">
                            <Input
                              type="text"
                              value={displayNameInput}
                              onChange={(e) => setDisplayNameInput(e.target.value)}
                              disabled={saving}
                              placeholder="Enter display name"
                              autoFocus
                            />
                            <Button
                              onClick={handleSaveDisplayName}
                              disabled={saving || !displayNameInput.trim()}
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
                              placeholder="No display name set"
                            />
                            <Button variant="secondary" onClick={handleStartEditDisplayName}>
                              Edit
                            </Button>
                          </div>
                        )}
                      </Field>
                      <Field label="Account status">
                        <div className="flex gap-2">
                          <span
                            className={`inline-flex px-3 py-1.5 text-xs font-medium rounded-full ${
                              account.is_approved
                                ? 'bg-brand-50 text-brand-800 border border-brand-200'
                                : 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                            }`}
                          >
                            {account.is_approved ? 'Approved' : 'Pending approval'}
                          </span>
                          {account.is_admin && (
                            <span className="inline-flex px-3 py-1.5 text-xs font-medium rounded-full bg-brand-100 text-brand-800 border border-brand-200">
                              Administrator
                            </span>
                          )}
                        </div>
                      </Field>
                    </div>
                  </section>

                  {/* Change Password - only for email/password-authenticated users */}
                  {supportsChangePassword && authManager.getActiveProviderId() === 'email' && (
                    <section className={sectionCls}>
                      <h2 className="section-heading">Change password</h2>

                      {!isChangingPassword ? (
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
                      ) : (
                        <div className="space-y-4 max-w-md">
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
                </div>
              )}

              {activeTab === 'users' && account.is_admin && (
                <div>
                  <section className={sectionCls}>
                    <div className="flex items-center justify-between">
                      <h2 className="section-heading">
                        Platform users{' '}
                        <span className="text-neutral-400 font-normal">({users.length})</span>
                      </h2>
                      <Button
                        variant="secondary"
                        onClick={loadUsers}
                        disabled={isPageLoading}
                        leading={
                          isPageLoading ? (
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
                    </div>
                    <PlatformUsersTable
                      users={users}
                      onApprove={handleApprove}
                      onRevoke={handleRevoke}
                      onDeny={handleDeny}
                      onGrantAdmin={handleGrantAdmin}
                      onRevokeAdmin={handleRevokeAdmin}
                      loading={isPageLoading}
                    />
                  </section>
                </div>
              )}
            </div>
          </div>
        </FadeIn>
      </div>

      {/* Loading Overlay */}
      <LoadingOverlay visible={saving} text="Processing..." />
    </>
  );
};
