import { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from '~/app/App';
import '~/styles/app.css';
import '~/shared/i18n';
import { RootErrorFallback } from '~/shared/ui/RootErrorFallback';
import { ErrorBoundary } from 'react-error-boundary';
import { client } from '~/api/client/client.gen';
import { setupClientInterceptors } from '~/features/auth/core/interceptors';
import { AuthProvider } from '~/app/providers/AuthProvider';
import { AuthGate } from '~/features/auth/ui/AuthGate';
import { legalKeyFromPath } from '~/features/legal/docs';
import { visualizerSlugFromPath } from '~/features/visualizers/route';
import { queryClient } from '~/api/queryClient';

const LegalPage = lazy(() => import('~/features/legal/LegalPage'));
const AgentRenderPage = lazy(() => import('~/features/annotation/AgentRenderPage'));
const VisualizerPage = lazy(() =>
  import('~/features/visualizers/VisualizerPage').then((m) => ({ default: m.VisualizerPage }))
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
// Opened by the SDK in a headless browser, which signs the page in itself.
const isAgentRender = window.location.pathname.replace(/\/$/, '') === '/agent-render';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={RootErrorFallback}>
    <QueryClientProvider client={queryClient}>
      {legalKey ? (
        <Suspense fallback={null}>
          <LegalPage doc={legalKey} />
        </Suspense>
      ) : isAgentRender ? (
        <Suspense fallback={null}>
          <AgentRenderPage />
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
