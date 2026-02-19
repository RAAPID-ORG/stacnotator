import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLayoutStore } from 'src/features/layout/layout.store';

const ANNOTATION_ROUTE = /^\/campaigns\/\d+\/annotate/;

/**
 * Auto-collapses the sidebar on annotation pages and expands it elsewhere.
 */
export const useRouteAwareSidebar = () => {
  const { pathname } = useLocation();
  const setSidebarCollapsed = useLayoutStore((state) => state.setSidebarCollapsed);

  useEffect(() => {
    setSidebarCollapsed(ANNOTATION_ROUTE.test(pathname));
  }, [pathname, setSidebarCollapsed]);
};
