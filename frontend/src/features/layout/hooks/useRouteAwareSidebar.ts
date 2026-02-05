import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLayoutStore } from 'src/features/layout/layout.store';

/**
 * Hook that automatically collapses the sidebar on annotation pages
 */
export const useRouteAwareSidebar = () => {
  const location = useLocation();
  const setSidebarCollapsed = useLayoutStore((state) => state.setSidebarCollapsed);

  useEffect(() => {
    // Auto-collapse sidebar on annotation pages for maximum canvas space
    const isAnnotationPage = /^\/campaigns\/\d+\/annotate/.test(location.pathname);
    
    if (isAnnotationPage) {
      setSidebarCollapsed(true);
    }
  }, [location.pathname, setSidebarCollapsed]);
};
