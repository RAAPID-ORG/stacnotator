import { useQuery } from '@tanstack/react-query';
import { getProjectOptions } from '~/api/queries';

export const PROJECT_ROUTE = /^\/projects\/(\d+)(?:\/campaigns\/(\d+))?/;

/** The project a route is about. The one place the app asks, so the breadcrumb,
 *  the org scope and ProjectPage all read the same cache entry - and a campaign
 *  page, whose API responses only carry a project id, can still name it. */
export const useProject = (projectId: number | null) => {
  // project_id is only read once `enabled` lets the query run; the placeholder
  // keeps the hook unconditional on routes outside a project.
  const { data, isPending } = useQuery({
    ...getProjectOptions({ path: { project_id: projectId ?? 0 } }),
    enabled: projectId !== null,
    meta: { errorMessage: 'Failed to load project' },
  });

  return { project: data, loading: projectId !== null && isPending };
};
