import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LoginScreen } from './LoginScreen';
import { ApprovalPendingScreen } from './ApprovalPendingScreen';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { useAccountStore } from '~/features/account/account.store';

/**
 * Gates the app behind authentication + backend approval.
 * Only shows children once the user is logged in and approved.
 */
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const { auth, loggedIn } = useAuth();
  const [initializing, setInitializing] = useState(true);

  const account = useAccountStore((s) => s.account);
  const fetchAccount = useAccountStore((s) => s.fetchAccount);
  const clear = useAccountStore((s) => s.clear);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        if (loggedIn) {
          await auth.getIdToken(); // warm Firebase session
          await fetchAccount();
        } else {
          clear();
        }
      } catch (e) {
        console.error('AuthGate init error:', e);
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

  if (account && !account.is_approved) return <ApprovalPendingScreen />;

  return <>{children}</>;
};
