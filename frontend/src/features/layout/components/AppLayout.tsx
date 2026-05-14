import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { Toaster } from 'sonner';
import { AppSidebar } from 'src/features/layout/components/AppSidebar';
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
    loadingOverlayVisible,
    loadingOverlayText,
    breadcrumbs,
    isFullscreen,
    sidebarCollapsed,
    setSidebarCollapsed,
    confirmDialog,
    resolveConfirmDialog,
  } = useLayoutStore();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] w-full">
      {!isFullscreen && (
        <AppSidebar
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          mobileOpen={mobileSidebarOpen}
          setMobileOpen={setMobileSidebarOpen}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <Toaster
          position="top-right"
          toastOptions={{
            classNames: {
              toast:
                'rounded-md border border-neutral-200 bg-white text-neutral-900 shadow-sm text-sm',
              title: 'text-sm font-medium text-neutral-900',
              description: 'text-xs text-neutral-600',
              error: 'border-l-2 border-l-red-500',
              success: 'border-l-2 border-l-brand-600',
              warning: 'border-l-2 border-l-amber-500',
              info: 'border-l-2 border-l-neutral-400',
            },
          }}
        />

        <LoadingOverlay visible={loadingOverlayVisible} text={loadingOverlayText} />

        <ConfirmDialog
          isOpen={!!confirmDialog}
          title={confirmDialog?.title ?? ''}
          description={confirmDialog?.description}
          confirmText={confirmDialog?.confirmText}
          cancelText={confirmDialog?.cancelText}
          isDangerous={confirmDialog?.isDangerous}
          showDontAskAgain={confirmDialog?.showDontAskAgain}
          onConfirm={(dontAskAgain) => {
            if (dontAskAgain && confirmDialog?.onDontAskAgain) {
              confirmDialog.onDontAskAgain();
            }
            resolveConfirmDialog(true);
          }}
          onCancel={() => resolveConfirmDialog(false)}
        />

        {!isFullscreen && (
          <Breadcrumbs items={breadcrumbs} onMenuClick={() => setMobileSidebarOpen(true)} />
        )}

        {/*Second ErrorBoundary to catch errors within page components*/}
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Outlet /> {/* Main page content rendered here */}
        </ErrorBoundary>
      </div>
    </div>
  );
};
