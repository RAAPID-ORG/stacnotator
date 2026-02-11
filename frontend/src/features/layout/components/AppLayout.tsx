import { Outlet } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { AppSidebar } from 'src/features/layout/components/AppSidebar';
import { Alert } from 'src/shared/ui/Alert';
import { ConfirmDialog } from 'src/shared/ui/ConfirmDialog';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { Breadcrumbs } from 'src/shared/ui/Breadcrumbs';
import { ErrorFallback } from 'src/shared/ui/ErrorFallback';
import { useLayoutStore } from 'src/features/layout/layout.store';
import { useRouteAwareSidebar } from 'src/features/layout/hooks/useRouteAwareSidebar';

/**
 * Main application layout
 * Renders the app shell with sidebar, alerts, loading overlays, and breadcrumbs
 * All layout-related state is managed via useLayoutStore - pages can trigger UI changes via the store
 */
export const AppLayout = () => {
  useRouteAwareSidebar(); // Custom hook to auto-collapse sidebar based on route

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
    confirmDialog,
    resolveConfirmDialog,
  } = useLayoutStore();

  return (
    <div className="flex h-screen w-full bg-neutral-50">
      {!isFullscreen && <AppSidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />}

      <div className="flex-1 flex flex-col overflow-hidden">
        <Alert message={alertMessage} type={alertType} onDismiss={hideAlert} />

        <LoadingOverlay visible={loadingOverlayVisible} text={loadingOverlayText} />

        <ConfirmDialog
          isOpen={!!confirmDialog}
          title={confirmDialog?.title ?? ''}
          description={confirmDialog?.description}
          confirmText={confirmDialog?.confirmText}
          cancelText={confirmDialog?.cancelText}
          isDangerous={confirmDialog?.isDangerous}
          onConfirm={() => resolveConfirmDialog(true)}
          onCancel={() => resolveConfirmDialog(false)}
        />

        {!isFullscreen && <Breadcrumbs items={breadcrumbs} />}

        {/*Second ErrorBoundary to catch errors within page components*/}
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Outlet /> {/* Main page content rendered here */}
        </ErrorBoundary>
      </div>
    </div>
  );
};
