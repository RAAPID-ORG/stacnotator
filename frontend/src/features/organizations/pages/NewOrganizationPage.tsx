import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { requestOrganizationMutation } from '~/api/queries';
import { organizationPath, projectsPath } from '~/app/routes';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useOrgStore } from '~/shared/stores/org.store';
import { Button, Field, Input, Textarea } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { useRefreshOrganizations } from '../hooks/useOrganizations';

export const NewOrganizationPage = () => {
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const setActiveOrgId = useOrgStore((s) => s.setActiveOrgId);
  const refreshOrganizations = useRefreshOrganizations();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [requestedName, setRequestedName] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: 'New organization' }]);
  }, [setBreadcrumbs]);

  // A platform admin's own request is approved on creation, so the response
  // decides between landing in the new organization and waiting for review.
  const request = useMutation({
    ...requestOrganizationMutation(),
    meta: { errorMessage: 'Failed to request organization', showUser: false },
    onSuccess: (organization) => {
      void refreshOrganizations();
      if (organization.status === 'pending') {
        setRequestedName(organization.name);
        setName('');
        setDescription('');
      } else {
        setActiveOrgId(organization.id);
        navigate(organizationPath(organization.id));
      }
    },
  });

  const submitting = request.isPending;
  const error = nameError ?? (request.error && extractErrorMessage(request.error)) ?? null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Name is required');
      return;
    }
    setNameError(null);
    request.mutate({ body: { name: trimmedName, description: description.trim() || null } });
  };

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">New organization</h1>
            <p className="page-subtitle">
              Organizations own projects and their members. A new one is reviewed by a platform
              admin before it can hold projects.
            </p>
          </div>
        </header>

        {requestedName ? (
          <div className="surface" data-testid="org-request-pending">
            <div className="surface-section space-y-3">
              <p className="text-sm font-medium text-neutral-900">
                Your organization request is awaiting platform approval.
              </p>
              <p className="text-sm text-neutral-500">
                {requestedName} stays in the organization switcher as pending until it is approved.
              </p>
            </div>
            <div className="surface-section flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setRequestedName(null)}>
                Request another
              </Button>
              <Button onClick={() => navigate(projectsPath())}>Back to projects</Button>
            </div>
          </div>
        ) : (
          <form className="surface" onSubmit={handleSubmit}>
            <div className="surface-section space-y-5">
              <Field label="Name" htmlFor="org-name" required error={error}>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="NASA Harvest"
                  invalid={Boolean(error)}
                  disabled={submitting}
                />
              </Field>
              <Field
                label="Description"
                htmlFor="org-description"
                hint="Optional. What the organization works on."
              >
                <Textarea
                  id="org-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
            <div className="surface-section flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => navigate(projectsPath())}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Requesting…' : 'Request organization'}
              </Button>
            </div>
          </form>
        )}
      </FadeIn>
    </div>
  );
};
