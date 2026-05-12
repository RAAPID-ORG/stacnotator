import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '~/app/providers/AuthProvider';
import { EmailVerificationScreen } from './EmailVerificationScreen';
import { LoginScreen } from './LoginScreen';
import { ApprovalPendingScreen } from './ApprovalPendingScreen';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { useAccountStore } from '~/features/account/account.store';
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
          await auth.getIdToken(); // warm Firebase session
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
      <div className="h-screen w-screen flex items-center justify-center bg-canvas">
        <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-8 w-full max-w-md text-center space-y-4">
          <h1 className="text-base font-semibold text-neutral-900">Couldn't load your account</h1>
          <p className="text-sm text-neutral-600">{accountError}</p>
          <div className="flex justify-center gap-2 pt-1">
            <button
              onClick={() => {
                fetchAccount();
              }}
              className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 cursor-pointer transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => {
                auth.logout();
              }}
              className="px-4 py-2 text-neutral-600 hover:text-neutral-900 text-sm cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!account) return <LoadingSpinner fullScreen text="Loading account…" />;

  if (!account.is_approved) return <ApprovalPendingScreen />;

  return <>{children}</>;
};
