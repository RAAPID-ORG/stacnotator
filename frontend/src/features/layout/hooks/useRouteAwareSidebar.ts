import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLayoutStore } from 'src/features/layout/layout.store';

const ANNOTATION_ROUTE = /^\/campaigns\/\d+\/annotate/;

// useLayoutEffect (not useEffect): collapse must happen pre-paint, otherwise
// the annotator grid mounts at the old width and re-lays out mid-transition.
export const useRouteAwareSidebar = () => {
  const { pathname } = useLocation();
  const setSidebarCollapsed = useLayoutStore((state) => state.setSidebarCollapsed);

  useLayoutEffect(() => {
    setSidebarCollapsed(ANNOTATION_ROUTE.test(pathname));
  }, [pathname, setSidebarCollapsed]);
};
