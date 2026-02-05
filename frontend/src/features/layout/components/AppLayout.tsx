import { Outlet } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { AppSidebar } from 'src/features/layout/components/AppSidebar';
import { Alert } from 'src/shared/ui/Alert';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Breadcrumbs } from 'src/shared/ui/Breadcrumbs';
import { ErrorFallback } from 'src/shared/ui/ErrorFallback';
import { useLayoutStore } from 'src/features/layout/layout.store';
import { useRouteAwareSidebar } from 'src/features/layout/hooks/useRouteAwareSidebar';

/**
 * Main application layout
 * Renders the app shell with sidebar, alerts, loading overlays, and breadcrumbs
 * All state is managed via useLayoutStore - pages can trigger UI changes via the store
 */
export const AppLayout = () => {
  // Enable route-aware sidebar auto-collapse
  useRouteAwareSidebar();

  // All layout state from a single source of truth
  const {
    alertMessage,
    alertType,
    hideAlert,
    loadingOverlayVisible,
    loadingOverlayText,
    breadcrumbs,
    isFullscreen,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useLayoutStore();

  return (
    <div className="flex h-screen w-full bg-neutral-50">
      {!isFullscreen && <AppSidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />}

      <div className="flex-1 flex flex-col overflow-hidden">
        <Alert message={alertMessage} type={alertType} onDismiss={hideAlert} />

        <LoadingOverlay visible={loadingOverlayVisible} text={loadingOverlayText} />

        {!isFullscreen && <Breadcrumbs items={breadcrumbs} />}

        {/*Second ErrorBoundary to catch errors within page components*/}
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Outlet /> {/* Main page content rendered here */}
        </ErrorBoundary>
      </div>
    </div>
  );
};
