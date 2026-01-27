import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '~/App';
import '~/app.css';

import { authManager } from '~/auth/index';
import { LoginScreen } from '~/auth/LoginScreen';
import { ApprovalPendingScreen } from '~/auth/ApprovalPendingScreen';
import { LoadingSpinner } from '~/components/shared/LoadingSpinner';
import { ErrorFallback } from '~/components/shared/ErrorFallback';
import { ErrorBoundary } from 'react-error-boundary';
import { client } from '~/api/client/client.gen';
import { setupClientInterceptors } from '~/api/hey-api';
import { useUserStore } from '~/stores/userStore';

// Configure API client with base URL
client.setConfig({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  throwOnError: true,
});

// Setup authentication and token refresh interceptors
setupClientInterceptors(client);

/**
 * Authentication gate component
 * Ensures user is logged in and approved before rendering the app
 */
const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const { getCurrentUser, clearUser, currentUser } = useUserStore();

  useEffect(() => {
    const unsubscribe = authManager.onAuthStateChanged(async (isLoggedIn) => {
      if (isLoggedIn) {
        try {
          await authManager.getIdToken();
          await getCurrentUser();
        } catch (error) {
          console.error('Failed to get token or fetch user data:', error);
          return;
        }
      } else {
        // Clear user data on logout
        clearUser();
      }
      setLoggedIn(isLoggedIn);
      setReady(true);
    });

    return unsubscribe;
  }, [getCurrentUser, clearUser]);

  if (!ready) {
    return <LoadingSpinner size="lg" text="Initializing..." fullScreen />;
  }

  if (!loggedIn) {
    return <LoginScreen />;
  }

  // Check if user is approved
  if (currentUser && !currentUser.is_approved) {
    return <ApprovalPendingScreen />;
  }

  return <>{children}</>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <AuthGate>
      <App />
    </AuthGate>
  </ErrorBoundary>
);
