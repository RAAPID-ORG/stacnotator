import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestOrganization } from '~/api/client';
import { organizationPath, projectsPath } from '~/app/routes';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useOrgStore } from '~/shared/stores/org.store';
import { Button, Field, Input, Textarea } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { handleError } from '~/shared/utils/errorHandler';
import { useOrganizations } from '../hooks/useOrganizations';

export const NewOrganizationPage = () => {
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const setActiveOrgId = useOrgStore((s) => s.setActiveOrgId);
  const { refresh } = useOrganizations();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedName, setRequestedName] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: 'New organization' }]);
  }, [setBreadcrumbs]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { data } = await requestOrganization({
        body: { name: trimmedName, description: description.trim() || null },
      });
      if (!data) {
        setError('The server did not return the new organization');
        return;
      }
      await refresh();
      if (data.status === 'pending') {
        setRequestedName(data.name);
        setName('');
        setDescription('');
      } else {
        setActiveOrgId(data.id);
        navigate(organizationPath(data.id));
      }
    } catch (err) {
      setError(handleError(err, 'Failed to request organization', { showUser: false }));
    } finally {
      setSubmitting(false);
    }
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
          <div className="surface p-6 space-y-4 max-w-xl" data-testid="org-request-pending">
            <p className="text-sm text-neutral-900">
              Your organization request is awaiting platform approval.
            </p>
            <p className="text-sm text-neutral-500">
              {requestedName} stays in the organization switcher as pending until it is approved.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => navigate(projectsPath())}>Back to projects</Button>
              <Button variant="secondary" onClick={() => setRequestedName(null)}>
                Request another
              </Button>
            </div>
          </div>
        ) : (
          <form className="surface p-6 space-y-5 max-w-xl" onSubmit={handleSubmit}>
            <Field label="Name" htmlFor="org-name" required error={error}>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Research"
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
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Requesting…' : 'Request organization'}
              </Button>
              <Button variant="secondary" onClick={() => navigate(projectsPath())}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </FadeIn>
    </div>
  );
};
