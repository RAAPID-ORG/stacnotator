import { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from 'src/app/App';
import 'src/styles/app.css';
import { RootErrorFallback } from 'src/shared/ui/RootErrorFallback';
import { ErrorBoundary } from 'react-error-boundary';
import { client } from 'src/api/client/client.gen';
import { setupClientInterceptors } from 'src/features/auth/core/interceptors';
import { AuthProvider } from 'src/app/providers/AuthProvider';
import { AuthGate } from 'src/features/auth/ui/AuthGate';
import { legalKeyFromPath } from 'src/features/legal/docs';

const LegalPage = lazy(() => import('src/features/legal/LegalPage'));

// Configure API client with base URL
client.setConfig({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  throwOnError: true,
});

// Setup authentication and token refresh interceptors
setupClientInterceptors(client);

/**
 * Root application render
 * ErrorBoundary here catches errors outside Router context (auth, app shell)
 * AuthProvider wraps everything to provide auth context
 * AuthGate handles login/approval flow before showing app
 * Second ErrorBoundary inside AppLayout catches errors within pages
 *
 * /legal/* branches off before any of that: the documents have to be readable
 * without an account, and AuthGate sits above the router.
 */
const legalKey = legalKeyFromPath(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={RootErrorFallback}>
    {legalKey ? (
      <Suspense fallback={null}>
        <LegalPage doc={legalKey} />
      </Suspense>
    ) : (
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    )}
  </ErrorBoundary>
);
