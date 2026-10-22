import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { editUserInfo, type MeOut } from '~/api/client';
import { useAuth } from '~/app/providers/AuthProvider';
import { useAccountStore } from '~/shared/stores/account.store';
import { Button, Field, Input } from '~/shared/ui/forms';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { AuthCard } from './AuthCard';
import { suggestUsername, usernameError, usernameRules } from '../utils/usernames';

/** Blocks the app until a new account has picked a username. Everyone lands
 *  here - the email sign-up form cannot ask for it (the account does not exist
 *  on the backend until the first authenticated call) and a Google sign-in has
 *  no form at all - so it is the one place the name is chosen. */
export const UsernameGate = ({ account }: { account: MeOut }) => {
  const { t } = useTranslation('auth');
  const { auth } = useAuth();
  const fetchAccount = useAccountStore((s) => s.fetchAccount);
  const [username, setUsername] = useState(() => suggestUsername(account.email));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localError = username ? usernameError(username) : null;

  const save = async () => {
    const chosen = username.trim();
    const invalid = usernameError(chosen);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await editUserInfo({
        path: { user_id: account.id },
        query: { new_display_name: chosen },
        throwOnError: true,
      });
      await fetchAccount();
    } catch (e) {
      setError(extractErrorMessage(e, t('username.saveFailed')));
      setSubmitting(false);
    }
  };

  return (
    <AuthCard className="space-y-4" outerClassName="bg-canvas">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">{t('username.title')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('username.intro')}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        <Field
          label={t('username.label')}
          htmlFor="username"
          error={error ?? localError ?? undefined}
        >
          <Input
            id="username"
            data-testid="username-input"
            value={username}
            autoFocus
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
            invalid={Boolean(error ?? localError)}
            disabled={submitting}
            placeholder={t('username.placeholder')}
          />
          <p className="mt-1 text-xs text-neutral-500">{usernameRules()}</p>
        </Field>

        <div className="flex items-center justify-between gap-4">
          <Button variant="quiet" type="button" onClick={() => auth.logout()} disabled={submitting}>
            {t('username.signOut')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            data-testid="save-username"
            disabled={submitting || Boolean(localError) || username.trim() === ''}
          >
            {submitting ? t('username.saving') : t('username.continue')}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
};
