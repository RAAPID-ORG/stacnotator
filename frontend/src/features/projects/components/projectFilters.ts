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
  /** Whether the viewer belongs to at least one organization (any status). */
  belongsToAnyOrg: boolean;
  query?: string;
}

/** The filter the page starts on. Anyone who is already in a project lands on
 *  their own work; only someone with none to show starts on the public list,
 *  which is the one thing they can browse without an organization. */
export const defaultProjectFilter = (
  activeOrgId: number | null,
  hasOwnProjects: boolean
): ProjectFilter => (hasOwnProjects || activeOrgId !== null ? 'mine' : 'public');

/** Access is already resolved by the backend, so these are presentation
 *  filters over what came back. With an active organization the filters scope
 *  to it; without one only platform-public projects show - except for viewers
 *  in no organization at all, whose explicit memberships (external invites)
 *  stay visible so they are not stranded. `organization` yields nothing
 *  without an active organization - the page prompts the user to pick one. */
export const filterProjects = (
  projects: ProjectOut[],
  { filter, activeOrgId, belongsToAnyOrg, query = '' }: FilterOptions
): ProjectOut[] => {
  const needle = query.trim().toLowerCase();

  return projects.filter((project) => {
    if (needle && !project.name.toLowerCase().includes(needle)) return false;

    const isPublic = project.visibility === 'public';

    if (activeOrgId === null) {
      const visible = isPublic || (!belongsToAnyOrg && !!project.is_member);
      if (!visible) return false;
      switch (filter) {
        case 'mine':
          return !!project.is_member;
        case 'organization':
          return false;
        case 'public':
          return isPublic;
        case 'all':
          return true;
      }
    }

    switch (filter) {
      case 'mine':
        return !!project.is_member && project.organization_id === activeOrgId;
      case 'organization':
        return project.organization_id === activeOrgId;
      case 'public':
        return isPublic;
      case 'all':
        return isPublic || !!project.is_member || project.organization_id === activeOrgId;
    }
  });
};
