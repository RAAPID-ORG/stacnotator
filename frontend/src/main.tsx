import ReactDOM from 'react-dom/client';
import { App } from 'src/app/App';
import 'src/styles/app.css';
import { RootErrorFallback } from 'src/shared/ui/RootErrorFallback';
import { ErrorBoundary } from 'react-error-boundary';
import { client } from 'src/api/client/client.gen';
import { setupClientInterceptors } from 'src/api/hey-api';
import { AuthProvider } from 'src/app/providers/AuthProvider';
import { AuthGate } from 'src/features/auth/ui/AuthGate';

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
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={RootErrorFallback}>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </ErrorBoundary>
);
