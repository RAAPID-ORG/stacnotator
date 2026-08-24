import { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from 'src/app/App';
import 'src/styles/app.css';
import { RootErrorFallback } from 'src/shared/ui/RootErrorFallback';
import { ErrorBoundary } from 'react-error-boundary';
import { client } from 'src/api/client/client.gen';
import { setupClientInterceptors } from 'src/features/auth/core/interceptors';
import { AuthProvider } from 'src/app/providers/AuthProvider';
import { AuthGate } from 'src/features/auth/ui/AuthGate';
import { legalKeyFromPath } from 'src/features/legal/docs';
import { visualizerSlugFromPath } from 'src/features/visualizers/route';
import { queryClient } from 'src/api/queryClient';

const LegalPage = lazy(() => import('src/features/legal/LegalPage'));
const VisualizerPage = lazy(() =>
  import('src/features/visualizers/VisualizerPage').then((m) => ({ default: m.VisualizerPage }))
);

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
 * /legal/* and /v/* branch off before any of that: legal documents have to be
 * readable without an account, and a published visualizer has to open for
 * anyone holding its link. The visualizer still gets AuthProvider, so a signed-in
 * viewer is recognised and can open their project's unpublished ones.
 */
const legalKey = legalKeyFromPath(window.location.pathname);
const visualizerSlug = visualizerSlugFromPath(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={RootErrorFallback}>
    <QueryClientProvider client={queryClient}>
      {legalKey ? (
        <Suspense fallback={null}>
          <LegalPage doc={legalKey} />
        </Suspense>
      ) : visualizerSlug ? (
        <AuthProvider>
          <Suspense fallback={null}>
            <VisualizerPage slug={visualizerSlug} />
          </Suspense>
        </AuthProvider>
      ) : (
        <AuthProvider>
          <AuthGate>
            <App />
          </AuthGate>
        </AuthProvider>
      )}
    </QueryClientProvider>
  </ErrorBoundary>
);
