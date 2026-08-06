import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listProjects, type ProjectOut } from '~/api/client';
import { newOrganizationPath, newProjectPath, projectPath } from '~/app/routes';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useOrgStore } from '~/shared/stores/org.store';
import { Button, Input } from '~/shared/ui/forms';
import { IconFolder, IconPlus } from '~/shared/ui/Icons';
import { FadeIn, MotionListItem } from '~/shared/ui/motion';
import { Delayed } from '~/shared/ui/Delayed';
import { Skeleton, SkeletonRows } from '~/shared/ui/Skeleton';
import { handleError } from '~/shared/utils/errorHandler';
import { ProjectRow } from '../components/ProjectRow';
import {
  defaultProjectFilter,
  filterProjects,
  PROJECT_FILTER_LABELS,
  PROJECT_FILTERS,
  type ProjectFilter,
} from '../components/projectFilters';
import { useOrganizations } from '~/features/organizations/hooks/useOrganizations';

export const ProjectsPage = () => {
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { orgs: memberships, loading: orgsLoading, error: orgsError } = useOrganizations();
  const { orgs: approvedOrgs } = useOrganizations({ approvedOnly: true });

  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [loading, setLoading] = useState(true);
  // Until the user picks a filter it tracks the active org, which may still be
  // resolving on first run (auto-select of the first approved org).
  const [userFilter, setUserFilter] = useState<ProjectFilter | null>(null);
  const filter = userFilter ?? defaultProjectFilter(activeOrgId);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setBreadcrumbs([{ label: 'Projects' }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const { data } = await listProjects();
        setProjects(data?.items ?? []);
      } catch (err) {
        handleError(err, 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  const belongsToAnyOrg = memberships.length > 0;

  const filtered = useMemo(
    () => filterProjects(projects, { filter, activeOrgId, belongsToAnyOrg, query }),
    [projects, filter, activeOrgId, belongsToAnyOrg, query]
  );

  const canCreateProject = approvedOrgs.length > 0;
  const showCreationGating = !canCreateProject && !orgsLoading && orgsError === null;
  const needsOrgSelection = filter === 'organization' && activeOrgId === null;

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Projects</h1>
            {loading ? (
              <Skeleton className="h-4 w-48 mt-1.5" />
            ) : (
              <p className="page-subtitle">
                {projects.length} project{projects.length === 1 ? '' : 's'} visible ·{' '}
                {filtered.length} shown
              </p>
            )}
          </div>
          {canCreateProject && (
            <Button
              onClick={() => navigate(newProjectPath())}
              leading={<IconPlus className="w-4 h-4" />}
            >
              New project
            </Button>
          )}
        </header>

        {showCreationGating && (
          <div
            data-testid="org-gating-panel"
            className="mb-4 flex flex-wrap items-center gap-4 px-4 py-3 rounded-lg border border-brand-200 bg-brand-50/50"
          >
            <div className="flex-1 min-w-[16rem]">
              <p className="text-sm font-medium text-neutral-900">
                Creating projects needs an organization
              </p>
              <p className="text-xs text-neutral-600 mt-0.5">
                Ask an organization admin to add you, or request a new organization for your team.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate(newOrganizationPath())}>
              Request an organization
            </Button>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex bg-white border border-neutral-200 rounded-md p-0.5 shadow-sm">
            {PROJECT_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                data-testid={`project-filter-${key}`}
                aria-pressed={filter === key}
                onClick={() => setUserFilter(key)}
                className={`px-3 h-7 text-xs font-medium rounded transition-colors ${
                  filter === key
                    ? 'bg-brand-50 text-brand-800'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {PROJECT_FILTER_LABELS[key]}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-[14rem] max-w-sm">
            <Input
              type="search"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <Delayed>
            <SkeletonRows count={6} />
          </Delayed>
        ) : (
          <div className="surface">
            {needsOrgSelection ? (
              <div className="p-10 text-center text-sm text-neutral-500">
                Select an organization to see its projects.
              </div>
            ) : filtered.length === 0 ? (
              <div className="surface-section text-center py-16">
                <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
                  <IconFolder className="w-6 h-6 text-brand-600" />
                </div>
                <p className="text-base text-neutral-800 font-medium mb-1">No projects here</p>
                <p className="text-sm text-neutral-500 mb-5">
                  {canCreateProject
                    ? 'Create a project to hold your campaigns, or widen the filter.'
                    : "You'll see projects here once you're added to one."}
                </p>
                {canCreateProject && (
                  <Button
                    onClick={() => navigate(newProjectPath())}
                    leading={<IconPlus className="w-4 h-4" />}
                  >
                    Create project
                  </Button>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {filtered.map((project, index) => (
                  <MotionListItem key={project.id} index={index}>
                    <ProjectRow
                      project={project}
                      onOpen={() => navigate(projectPath(project.id))}
                    />
                  </MotionListItem>
                ))}
              </ul>
            )}
          </div>
        )}
      </FadeIn>
    </div>
  );
};
