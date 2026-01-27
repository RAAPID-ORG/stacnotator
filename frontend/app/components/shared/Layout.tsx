import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { useEffect, useState } from 'react';
import { Sidebar } from '~/components/shared/Sidebar';
import { Alert } from '~/components/shared/Alert';
import { LoadingOverlay } from '~/components/shared/LoadingOverlay';
import { Breadcrumbs } from '~/components/shared/Breadcrumbs';
import { ErrorFallback } from '~/components/shared/ErrorFallback';
import { useUIStore } from '~/stores/uiStore';

/**
 * Main application layout
 * Handles global UI concerns: alerts, loading overlays, breadcrumbs
 * Pages can trigger these via the useUIStore hook
 */
export const Layout = () => {
  const location = useLocation();

  // Global UI state
  const alertMessage = useUIStore(state => state.alertMessage);
  const alertType = useUIStore(state => state.alertType);
  const loadingOverlayVisible = useUIStore(state => state.loadingOverlayVisible);
  const loadingOverlayText = useUIStore(state => state.loadingOverlayText);
  const breadcrumbs = useUIStore(state => state.breadcrumbs);
  const hideAlert = useUIStore(state => state.hideAlert);
  const isFullscreen = useUIStore(state => state.isFullscreen);
  const setIsFullscreen = useUIStore(state => state.setIsFullscreen);

  const isAnnotationPage = /^\/campaigns\/\d+\/annotate/.test(location.pathname);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(isAnnotationPage);

  // Listen for fullscreen changes (e.g., when user presses F11 or ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      if (isCurrentlyFullscreen !== isFullscreen) {
        setIsFullscreen(isCurrentlyFullscreen);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isFullscreen, setIsFullscreen]);

  return (
    <div className="flex h-screen w-full bg-neutral-50">
      {!isFullscreen && <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />}
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Alert 
          message={alertMessage} 
          type={alertType} 
          onDismiss={hideAlert} 
        />
        
        <LoadingOverlay 
          visible={loadingOverlayVisible} 
          text={loadingOverlayText} 
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
