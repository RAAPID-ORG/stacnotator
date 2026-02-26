import React, { createContext, useContext, useEffect, useState } from 'react';
import { authManager } from '~/features/auth';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';

type AuthContextValue = {
  auth: typeof authManager;
  loggedIn: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Exposes { auth, loggedIn } via context.
 * Waits for Firebase to resolve any persisted session before rendering children,
 * so we don't briefly flash the login screen.
 */
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
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

  return (
    <AuthContext.Provider value={{ auth: authManager, loggedIn }}>{children}</AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>');
  return ctx;
};
