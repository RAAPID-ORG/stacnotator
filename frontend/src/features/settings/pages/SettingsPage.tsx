import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '~/app/providers/AuthProvider';
import { PlatformUsersTable } from '~/features/settings/components/PlatformUsersTable';
import { PlatformOrganizationsTable } from '~/features/settings/components/PlatformOrganizationsTable';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Button, Field, Input, Select } from '~/shared/ui/forms';
import { LANGUAGES } from '~/shared/i18n';
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
import { TabNavigator } from '~/shared/ui/TabNavigator';
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

const RefreshButton = ({ onClick, busy }: { onClick: () => void; busy: boolean }) => {
  const { t } = useTranslation('settings');
  return (
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
      {t('refresh')}
    </Button>
  );
};

export const SettingsPage = () => {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile' | 'platform'>('profile');
  const [platformTab, setPlatformTab] = useState<'organizations' | 'users'>('organizations');

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
    enabled: isPlatformAdmin && activeTab === 'platform' && platformTab === 'users',
    meta: { errorMessage: t('toasts.loadUsersFailed') },
  });
  const users = useMemo(() => (usersQuery.data ?? []).filter(isDetailedUser), [usersQuery.data]);

  const tilersQuery = useQuery({
    ...listGrantableTilersOptions(),
    enabled: isPlatformAdmin && activeTab === 'platform' && platformTab === 'organizations',
    meta: { errorMessage: t('toasts.loadTilersFailed') },
  });

  const refreshOrganizationsTab = () => {
    void refreshOrganizations();
    void queryClient.invalidateQueries({ queryKey: listGrantableTilersQueryKey() });
  };

  useEffect(() => {
    setBreadcrumbs([{ label: t('breadcrumb') }]);
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

  const editUsername = useMutation({
    ...editUserInfoMutation(),
    meta: { errorMessage: t('toasts.usernameFailed') },
    onSuccess: async () => {
      await fetchAccount();
      setIsEditingDisplayName(false);
      showAlert(t('toasts.usernameUpdated'), 'success');
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

  const handleSignOut = async () => {
    try {
      await auth.logout();
      navigate('/');
    } catch (err) {
      handleError(err, t('toasts.signOutFailed'));
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
                {t('tabs.profile')}
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
                    {t('tabs.platform')}
                    <CountBadge
                      count={pendingAdminActions(knownOrgs, account.is_admin).organizationApprovals}
                      label={t('tabs.organizationsToReview')}
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

                  <section className={sectionCls}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="section-heading">{t('signOut.title')}</h2>
                        <p className="section-description">{t('signOut.description')}</p>
                      </div>
                      <Button
                        variant="dangerQuiet"
                        data-testid="sign-out-button"
                        onClick={handleSignOut}
                      >
                        {t('signOut.button')}
                      </Button>
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'platform' && isPlatformAdmin && (
                <div>
                  <TabNavigator
                    items={[
                      {
                        id: 'organizations',
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            {t('tabs.organizations')}
                            <CountBadge
                              count={
                                pendingAdminActions(knownOrgs, account.is_admin)
                                  .organizationApprovals
                              }
                              label={t('tabs.organizationsToReview')}
                            />
                          </span>
                        ),
                      },
                      { id: 'users', label: t('tabs.users') },
                    ]}
                    activeId={platformTab}
                    onChange={setPlatformTab}
                  />
                  {platformTab === 'users' && (
                    <section id="tab-users" role="tabpanel" className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="section-heading">
                          <Trans
                            t={t}
                            i18nKey="platform.usersHeading"
                            values={{ count: users.length }}
                            components={{
                              count: <span className="text-neutral-400 font-normal" />,
                            }}
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
                            components={{
                              count: <span className="text-neutral-400 font-normal" />,
                            }}
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
              )}
            </div>
          </div>
        </FadeIn>
      </div>

      <LoadingOverlay visible={saving} text={t('processing')} />
    </>
  );
};
