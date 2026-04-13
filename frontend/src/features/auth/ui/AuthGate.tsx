import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { EmailVerificationScreen } from './EmailVerificationScreen';
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
  const accountError = useAccountStore((s) => s.error);
  const emailNotVerified = useAccountStore((s) => s.emailNotVerified);
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

  if (emailNotVerified) return <EmailVerificationScreen />;

  if (!account && accountError) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-8 w-full max-w-md text-center">
          <p className="text-sm text-red-600 mb-4">Failed to load account: {accountError}</p>
          <button
            onClick={() => {
              fetchAccount();
            }}
            className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 cursor-pointer transition-colors"
          >
            Retry
          </button>
          <button
            onClick={() => {
              auth.logout();
            }}
            className="ml-3 px-4 py-2 text-neutral-600 hover:text-neutral-800 text-sm cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (!account) return <LoadingSpinner fullScreen text="Loading account…" />;

  if (!account.is_approved) return <ApprovalPendingScreen />;

  return <>{children}</>;
};
