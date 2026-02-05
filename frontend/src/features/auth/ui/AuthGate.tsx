import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LoginScreen } from './LoginScreen';
import { ApprovalPendingScreen } from './ApprovalPendingScreen';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { useAccountStore } from '~/features/account/account.store';


export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const { auth, loggedIn } = useAuth();
  const [ready, setReady] = useState(false);

  // Use individual selectors to avoid creating new objects on every render
  const account = useAccountStore((s) => s.account);
  const fetchAccount = useAccountStore((s) => s.fetchAccount);
  const clear = useAccountStore((s) => s.clear);
  const loading = useAccountStore((s) => s.loading);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        if (loggedIn) {
          // Ensure token exists (also warms Firebase session).
          await auth.getIdToken();
          await fetchAccount();
        } else {
          clear();
        }
      } catch (e) {
        // If token fetch fails, you may choose to logout.
        console.error('AuthGate init error:', e);
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [loggedIn, auth, fetchAccount, clear]);

  if (!ready || loading) return <LoadingSpinner fullScreen text="Initializing…" />;

  if (!loggedIn) return <LoginScreen />;

  // Gate on backend approval (domain).
  if (account && !account.is_approved) return <ApprovalPendingScreen />;

  return <>{children}</>;
};
