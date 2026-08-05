import type { ProjectOut } from '~/api/client';

export const PROJECT_FILTERS = ['mine', 'organization', 'public', 'all'] as const;

export type ProjectFilter = (typeof PROJECT_FILTERS)[number];

export const PROJECT_FILTER_LABELS: Record<ProjectFilter, string> = {
  mine: 'My projects',
  organization: 'Organization',
  public: 'Public',
  all: 'All',
};

interface FilterOptions {
  filter: ProjectFilter;
  activeOrgId: number | null;
  query?: string;
}

/** Visibility is already resolved by the backend, so these are presentation
 *  filters over what came back. `organization` yields nothing without an
 *  active organization - the page prompts the user to pick one. */
export const filterProjects = (
  projects: ProjectOut[],
  { filter, activeOrgId, query = '' }: FilterOptions
): ProjectOut[] => {
  const needle = query.trim().toLowerCase();

  return projects.filter((project) => {
    if (needle && !project.name.toLowerCase().includes(needle)) return false;

    switch (filter) {
      case 'mine':
        if (!project.is_member) return false;
        return activeOrgId === null || project.organization_id === activeOrgId;
      case 'organization':
        return activeOrgId !== null && project.organization_id === activeOrgId;
      case 'public':
        return !!project.is_public;
      case 'all':
        return true;
    }
  });
};
