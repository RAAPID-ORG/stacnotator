import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authManager } from '~/features/auth';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';

type AuthContextValue = {
  auth: typeof authManager;
  loggedIn: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Renders a spinner until the auth manager resolves any persisted session,
 * so we don't briefly flash the login screen on reload.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return authManager.onAuthStateChanged((isLoggedIn) => {
      setLoggedIn(isLoggedIn);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return <LoadingSpinner fullScreen size="lg" />;
  }

  return <AuthContext value={{ auth: authManager, loggedIn }}>{children}</AuthContext>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
};
