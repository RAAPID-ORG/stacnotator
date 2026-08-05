import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { updateOrganization, type OrganizationOut } from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Badge, type BadgeTone } from '~/shared/ui/Badge';
import { Button, Field, Input, Textarea } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { handleError } from '~/shared/utils/errorHandler';
import { OrganizationMembers } from '../components/OrganizationMembers';
import { useOrganizations } from '../hooks/useOrganizations';

const STATUS_TONES: Record<string, BadgeTone> = {
  approved: 'green',
  pending: 'yellow',
  rejected: 'red',
};

type DetailsFormProps = {
  org: OrganizationOut;
  onSaved: () => Promise<void>;
};

const DetailsForm = ({ org, onSaved }: DetailsFormProps) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setName(org.name);
    setDescription(org.description ?? '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    try {
      await updateOrganization({
        path: { organization_id: org.id },
        body: { name: trimmedName, description: description.trim() || null },
      });
      await onSaved();
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(handleError(err, 'Failed to save organization', { showUser: false }));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="surface surface-section flex items-start justify-between gap-4">
        <div>
          <h2 className="section-heading">Details</h2>
          <p className="text-sm text-neutral-600">{org.description || 'No description yet.'}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={startEditing}>
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="surface surface-section space-y-4 max-w-xl">
      <h2 className="section-heading">Details</h2>
      <Field label="Name" htmlFor="org-edit-name" required error={error}>
        <Input
          id="org-edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          invalid={Boolean(error)}
          disabled={saving}
        />
      </Field>
      <Field label="Description" htmlFor="org-edit-description">
        <Textarea
          id="org-edit-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={saving}
        />
      </Field>
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export const OrganizationPage = () => {
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const { orgId } = useParams();
  const organizationId = Number(orgId);
  const { orgs, loading, error, refresh } = useOrganizations();

  const org = orgs.find((o) => o.id === organizationId);

  useEffect(() => {
    setBreadcrumbs([{ label: org?.name ?? 'Organization' }]);
  }, [setBreadcrumbs, org?.name]);

  if (loading) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="page text-sm text-neutral-500">Loading organization…</div>
      </div>
    );
  }

  if (!org && error) {
    return (
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              <h1 className="page-title">Organization</h1>
              <p className="page-subtitle">Could not load organizations. {error}</p>
            </div>
          </header>
          <Button variant="secondary" onClick={() => refresh()}>
            Try again
          </Button>
        </FadeIn>
      </div>
    );
  }

  if (!org || !org.is_admin) {
    return (
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              <h1 className="page-title">Organization</h1>
              <p className="page-subtitle">You are not an admin of this organization.</p>
            </div>
          </header>
        </FadeIn>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page space-y-4">
        <header className="page-header">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="page-title">{org.name}</h1>
              <Badge tone={STATUS_TONES[org.status] ?? 'neutral'} className="capitalize">
                {org.status}
              </Badge>
            </div>
            <p className="page-subtitle">Manage the organization details and its members.</p>
          </div>
        </header>

        <DetailsForm org={org} onSaved={refresh} />
        <OrganizationMembers organizationId={org.id} />
      </FadeIn>
    </div>
  );
};
