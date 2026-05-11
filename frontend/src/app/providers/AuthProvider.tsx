import { createContext, useEffect, useState, type ReactNode } from 'react';
import { authManager } from '~/features/auth';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';

export type AuthContextValue = {
  auth: typeof authManager;
  loggedIn: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Exposes { auth, loggedIn } via context.
 * Waits for Firebase to resolve any persisted session before rendering children,
 * so we don't briefly flash the login screen.
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
