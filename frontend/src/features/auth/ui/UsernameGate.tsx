import { useState } from 'react';
import { editUserInfo, type MeOut } from '~/api/client';
import { useAuth } from '~/app/providers/AuthProvider';
import { useAccountStore } from '~/shared/stores/account.store';
import { Button, Field, Input } from '~/shared/ui/forms';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { AuthCard } from './AuthCard';
import { suggestUsername, usernameError, USERNAME_RULES } from '../utils/usernames';

/** Blocks the app until a new account has picked a username. Everyone lands
 *  here - the email sign-up form cannot ask for it (the account does not exist
 *  on the backend until the first authenticated call) and a Google sign-in has
 *  no form at all - so it is the one place the name is chosen. */
export const UsernameGate = ({ account }: { account: MeOut }) => {
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
      setError(extractErrorMessage(e, 'Could not save that username. Please try another.'));
      setSubmitting(false);
    }
  };

  return (
    <AuthCard className="space-y-4" outerClassName="bg-canvas">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Pick a username</h1>
        <p className="mt-1 text-sm text-neutral-600">
          This is the name other people see on your annotations and in the organizations you join.
          It has to be unique, and you can change it later in settings.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        <Field label="Username" htmlFor="username" error={error ?? localError ?? undefined}>
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
            placeholder="e.g. ada.lovelace"
          />
          <p className="mt-1 text-xs text-neutral-500">{USERNAME_RULES}</p>
        </Field>

        <div className="flex items-center justify-between gap-4">
          <Button variant="quiet" type="button" onClick={() => auth.logout()} disabled={submitting}>
            Sign out
          </Button>
          <Button
            type="submit"
            variant="primary"
            data-testid="save-username"
            disabled={submitting || Boolean(localError) || username.trim() === ''}
          >
            {submitting ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
};
