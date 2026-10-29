const PROJECT_SECTIONS = ['campaigns', 'visualizers', 'members', 'settings'] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

type ProjectAccess = { is_admin?: boolean | null; is_member?: boolean | null };

/** The sections of a project this viewer may open: members see who else is in
 *  it, and only admins see its settings. */
export const projectSections = (project: ProjectAccess): ProjectSection[] => {
  const isAdmin = project.is_admin ?? false;
  return PROJECT_SECTIONS.filter(
    (section) =>
      (section !== 'members' || isAdmin || (project.is_member ?? false)) &&
      (section !== 'settings' || isAdmin)
  );
};

export const isProjectSection = (value: string | null): value is ProjectSection =>
  PROJECT_SECTIONS.some((section) => section === value);
