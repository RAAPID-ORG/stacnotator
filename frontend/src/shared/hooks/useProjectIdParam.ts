import { useParams } from 'react-router-dom';

/**
 * The project id from the route. The `requireProjectId` route loader validates
 * the param before these pages render, so the value is always a real id.
 */
export function useProjectIdParam(): number {
  const { projectId } = useParams<{ projectId: string }>();
  return Number(projectId);
}
