import React, { createContext, useContext, useEffect, useState } from 'react';
import { authManager } from '~/features/auth';

type AuthContextValue = {
  auth: typeof authManager;
  loggedIn: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Exposes { auth, loggedIn } via context.
 */
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [loggedIn, setLoggedIn] = useState(() => authManager.isAuthenticated());

  useEffect(() => {
    return authManager.onAuthStateChanged(setLoggedIn);
  }, []);

  return (
    <AuthContext.Provider value={{ auth: authManager, loggedIn }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>');
  return ctx;
};
