import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '~/app/providers/AuthProvider';
import { EmailVerificationScreen } from './EmailVerificationScreen';
import { LoginScreen } from './LoginScreen';
import { ApprovalPendingScreen } from './ApprovalPendingScreen';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { Button } from '~/shared/ui/forms';
import { AuthCard } from './AuthCard';
import { useAccountStore } from '~/shared/stores/account.store';
import { handleError } from '~/shared/utils/errorHandler';

/**
 * Gates the app behind authentication + backend approval.
 * Only shows children once the user is logged in and approved.
 */
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const { auth, loggedIn } = useAuth();
  const [initializing, setInitializing] = useState(true);

  const account = useAccountStore((s) => s.account);
  const accountError = useAccountStore((s) => s.error);
  const emailNotVerified = useAccountStore((s) => s.emailNotVerified);
  const fetchAccount = useAccountStore((s) => s.fetchAccount);
  const clear = useAccountStore((s) => s.clear);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        if (loggedIn) {
          await auth.getIdToken(); // warm session
          await fetchAccount();
        } else {
          clear();
        }
      } catch (e) {
        handleError(e, 'AuthGate init error', { showUser: false });
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auth, fetchAccount, clear are stable store singletons
  }, [loggedIn]);

  if (initializing) return <LoadingSpinner fullScreen text="Initializing…" />;

  if (!loggedIn) return <LoginScreen />;

  if (emailNotVerified) return <EmailVerificationScreen />;

  if (!account && accountError) {
    return (
      <AuthCard className="text-center space-y-4" outerClassName="bg-canvas">
        <h1 className="text-base font-semibold text-neutral-900">Couldn't load your account</h1>
        <p className="text-sm text-neutral-600">{accountError}</p>
        <div className="flex justify-center gap-2 pt-1">
          <Button variant="primary" onClick={() => fetchAccount()}>
            Try again
          </Button>
          <Button variant="quiet" onClick={() => auth.logout()}>
            Sign out
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (!account) return <LoadingSpinner fullScreen text="Loading account…" />;

  if (!account.is_approved) return <ApprovalPendingScreen />;

  return <>{children}</>;
};
