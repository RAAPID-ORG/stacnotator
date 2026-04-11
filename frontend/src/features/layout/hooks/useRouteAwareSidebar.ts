import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLayoutStore } from 'src/features/layout/layout.store';

const ANNOTATION_ROUTE = /^\/campaigns\/\d+\/annotate/;

/**
 * Auto-collapses the sidebar on annotation pages and expands it elsewhere.
 *
 * Uses useLayoutEffect (not useEffect) so the collapse happens synchronously
 * before the browser paints. Otherwise the annotation canvas mounts at the
 * old (expanded) width, its ResizeObserver fires, and ReactGridLayout re-
 * lays out the whole grid mid-transition - which reads as a visible jerk
 * as the user navigates into the annotator.
 */
export const useRouteAwareSidebar = () => {
  const { pathname } = useLocation();
  const setSidebarCollapsed = useLayoutStore((state) => state.setSidebarCollapsed);

  useLayoutEffect(() => {
    setSidebarCollapsed(ANNOTATION_ROUTE.test(pathname));
  }, [pathname, setSidebarCollapsed]);
};
