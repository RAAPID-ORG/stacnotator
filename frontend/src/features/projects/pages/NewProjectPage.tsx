import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createProject } from '~/api/client';
import { newOrganizationPath, projectPath, projectsPath } from '~/app/routes';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useOrgStore } from '~/shared/stores/org.store';
import { Button, Field, Input, Select, Textarea } from '~/shared/ui/forms';
import { IconPlus } from '~/shared/ui/Icons';
import { FadeIn } from '~/shared/ui/motion';
import { SkeletonForm, SkeletonPage } from '~/shared/ui/Skeleton';
import { handleError } from '~/shared/utils/errorHandler';
import { useOrganizations } from '~/features/organizations/hooks/useOrganizations';

export const NewProjectPage = () => {
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { orgs: organizations, loading } = useOrganizations({ approvedOnly: true });

  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Projects', path: projectsPath() }, { label: 'New project' }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (organizations.length === 0) return;
    setOrganizationId((current) => {
      if (current !== null && organizations.some((org) => org.id === current)) return current;
      const active = organizations.find((org) => org.id === activeOrgId);
      return active ? active.id : organizations[0].id;
    });
  }, [organizations, activeOrgId]);

  const handleSubmit = async () => {
    if (organizationId === null || !name.trim() || submitting) return;

    setSubmitting(true);
    try {
      const { data: project } = await createProject({
        body: {
          organization_id: organizationId,
          name: name.trim(),
          description: description.trim() || null,
          is_public: isPublic,
        },
      });
      showAlert('Project created', 'success');
      navigate(project ? projectPath(project.id) : projectsPath());
    } catch (err) {
      handleError(err, 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SkeletonPage action={false}>
        <SkeletonForm sections={2} />
      </SkeletonPage>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">New project</h1>
            <p className="page-subtitle">
              A project groups campaigns and the people working on them.
            </p>
          </div>
        </header>

        {organizations.length === 0 ? (
          <div className="surface">
            <div className="surface-section text-center py-16">
              <p className="text-base text-neutral-800 font-medium mb-1">
                No organization to create in
              </p>
              <p className="text-sm text-neutral-500 mb-5">
                Projects live inside an organization. Request one to get started.
              </p>
              <Button
                onClick={() => navigate(newOrganizationPath())}
                leading={<IconPlus className="w-4 h-4" />}
              >
                New organization
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="surface"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div className="surface-section space-y-5">
              <Field label="Organization" htmlFor="project-organization" required>
                <Select
                  id="project-organization"
                  value={organizationId ?? ''}
                  onChange={(e) => setOrganizationId(Number(e.target.value))}
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Name" htmlFor="project-name" required>
                <Input
                  id="project-name"
                  placeholder="Your project name…"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <Field label="Description" htmlFor="project-description">
                <Textarea
                  id="project-description"
                  placeholder="What is this project about?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="mt-1 text-brand-700 focus:ring-brand-600"
                />
                <span className="flex-1">
                  <span className="block font-medium text-sm text-neutral-900">Public project</span>
                  <span className="block text-sm text-neutral-600">
                    Public projects can be worked on by anyone registered on the platform.
                  </span>
                </span>
              </label>
            </div>

            <div className="surface-section flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => navigate(projectsPath())}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? 'Creating…' : 'Create project'}
              </Button>
            </div>
          </form>
        )}
      </FadeIn>
    </div>
  );
};
