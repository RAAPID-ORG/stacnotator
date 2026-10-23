import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Button, Field, Input, Select } from '~/shared/ui/forms';
import { LANGUAGES } from '~/shared/i18n';
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
import { LEGAL_DOCS, legalPath } from '~/features/legal/docs';

export const SettingsPage = () => {
  const { t, i18n } = useTranslation(['settings', 'common']);
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
    setBreadcrumbs([{ label: t('breadcrumb') }]);
  }, [setBreadcrumbs, t]);

  // Use individual selectors to avoid creating new objects on every render
  const account = useAccountStore((s) => s.account);
  const fetchAccount = useAccountStore((s) => s.fetchAccount);

  const editUsername = useMutation({
    ...editUserInfoMutation(),
    meta: { errorMessage: t('toasts.usernameFailed') },
    onSuccess: async () => {
      await fetchAccount();
      setIsEditingDisplayName(false);
      showAlert(t('toasts.usernameUpdated'), 'success');
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
      setPasswordError(t('password.errors.missingFields'));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(t('password.errors.mismatch'));
      return;
    }
    if (!newPasswordMeetsRequirements) {
      setPasswordError(t('password.errors.requirements'));
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
      showAlert(t('toasts.passwordChanged'), 'success');
    } catch (err) {
      setPasswordError(authErrorMessage(err, CHANGE_PASSWORD_ERRORS, t('password.errors.failed')));
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
              <h1 className="page-title">{t('title')}</h1>
              <p className="page-subtitle">{t('subtitle')}</p>
            </div>
          </header>

          <div className="surface">
            <div className="p-6">
              <div>
                <section className={sectionCls}>
                  <h2 className="section-heading">{t('profile.title')}</h2>
                  <div className="space-y-4">
                    <Field label={t('profile.email')}>
                      <Input type="text" value={account.email} disabled />
                    </Field>
                    <Field
                      label={t('profile.username')}
                      error={isEditingDisplayName ? usernameError(displayNameInput) : undefined}
                    >
                      {isEditingDisplayName ? (
                        <div className="flex gap-2">
                          <Input
                            type="text"
                            value={displayNameInput}
                            onChange={(e) => setDisplayNameInput(e.target.value)}
                            disabled={saving}
                            placeholder={t('profile.usernamePlaceholder')}
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
                            {t('common:actions.save')}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={handleCancelEditDisplayName}
                            disabled={saving}
                          >
                            {t('common:actions.cancel')}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Input
                            type="text"
                            value={account.display_name || ''}
                            disabled
                            placeholder={t('profile.noUsername')}
                          />
                          <Button variant="secondary" onClick={handleStartEditDisplayName}>
                            {t('common:actions.edit')}
                          </Button>
                        </div>
                      )}
                    </Field>
                    {account.is_admin && (
                      <Field label={t('profile.role')}>
                        <span className="inline-flex px-3 py-1.5 text-xs font-medium rounded-full bg-brand-100 text-brand-800 border border-brand-200">
                          {t('profile.administrator')}
                        </span>
                      </Field>
                    )}
                  </div>
                </section>

                <section className={sectionCls}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="section-heading">{t('language.title')}</h2>
                      <p className="section-description">{t('language.description')}</p>
                    </div>
                    <div className="w-40 shrink-0">
                      <Select
                        value={i18n.resolvedLanguage}
                        onChange={(e) => i18n.changeLanguage(e.target.value)}
                        aria-label={t('language.title')}
                      >
                        {LANGUAGES.map((language) => (
                          <option key={language.code} value={language.code} lang={language.code}>
                            {language.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </section>

                {/* Change Password - only for email/password-authenticated users */}
                {supportsChangePassword && authManager.getActiveProviderId() === 'email' && (
                  <section className={sectionCls}>
                    {!isChangingPassword ? (
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h2 className="section-heading">{t('password.title')}</h2>
                          <p className="section-description">{t('password.description')}</p>
                        </div>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setIsChangingPassword(true);
                            setPasswordError(null);
                            setPasswordSuccess(false);
                          }}
                        >
                          {t('password.change')}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4 max-w-md">
                        <h2 className="section-heading">{t('password.title')}</h2>
                        {passwordError && (
                          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                            {passwordError}
                          </div>
                        )}
                        <Field label={t('password.current')}>
                          <Input
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            disabled={saving}
                            autoComplete="current-password"
                          />
                        </Field>
                        <Field label={t('password.new')}>
                          <Input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={saving}
                            autoComplete="new-password"
                          />
                          <PasswordRequirementsList password={newPassword} />
                        </Field>
                        <Field label={t('password.confirmNew')}>
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
                            {saving ? t('password.saving') : t('password.update')}
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
                            {t('common:actions.cancel')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>

          <nav className="mt-4 flex gap-4 px-1 text-xs text-neutral-500">
            {LEGAL_DOCS.map((doc) => (
              <a
                key={doc}
                href={legalPath(doc)}
                target="_blank"
                rel="noreferrer"
                className="hover:text-neutral-800 hover:underline"
              >
                {t(`common:legal.${doc}`)}
              </a>
            ))}
          </nav>
        </FadeIn>
      </div>

      <LoadingOverlay visible={saving} text={t('processing')} />
    </>
  );
};
