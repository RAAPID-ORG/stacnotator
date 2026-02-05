import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { authManager } from '~/features/auth';
import type { AuthAdapter } from '~/features/auth/core/authAdapter';

type AuthContextValue = {
  auth: AuthAdapter;
  loggedIn: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Observes auth state changes from the headless authManager.
 * Exposes {auth, loggedIn} via context to the rest of the app.
 */
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const auth = useMemo(() => authManager as AuthAdapter, []);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    // Fast initial check (handles persisted sessions).
    setLoggedIn(auth.isAuthenticated());

    const unsub = auth.onAuthStateChanged((isLoggedIn: boolean) => {
      setLoggedIn(isLoggedIn);
    });

    return unsub;
  }, [auth]);

  return <AuthContext.Provider value={{ auth, loggedIn }}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>');
  return ctx;
};
