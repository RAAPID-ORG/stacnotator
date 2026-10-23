import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Button, Field, Input } from '~/shared/ui/forms';
import { useLayoutStore } from 'src/shared/stores/layout.store';
import { editUserInfoMutation } from '~/api/queries';
import { useAccountStore } from '~/shared/stores/account.store';
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

export const SettingsPage = () => {
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

  useEffect(() => {
    setBreadcrumbs([{ label: 'Settings' }]);
  }, [setBreadcrumbs]);

  // Use individual selectors to avoid creating new objects on every render
  const account = useAccountStore((s) => s.account);
  const fetchAccount = useAccountStore((s) => s.fetchAccount);

  const editUsername = useMutation({
    ...editUserInfoMutation(),
    meta: { errorMessage: 'Failed to update username' },
    onSuccess: async () => {
      await fetchAccount();
      setIsEditingDisplayName(false);
      showAlert('Username updated', 'success');
    },
  });

  const saving = editUsername.isPending || changingPassword;

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
              <p className="page-subtitle">Manage your profile and sign-in.</p>
            </div>
          </header>

          <div className="surface">
            <div className="p-6">
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
              </div>
            </div>
          </div>
        </FadeIn>
      </div>

      <LoadingOverlay visible={saving} text="Processing..." />
    </>
  );
};
