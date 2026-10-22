import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { type OrganizationOut } from '~/api/client';
import { updateOrganizationMutation } from '~/api/queries';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Badge, type BadgeTone } from '~/shared/ui/Badge';
import { Button, Field, Input, Textarea } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { Skeleton, SkeletonForm } from '~/shared/ui/Skeleton';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { AccessRequests } from '../components/AccessRequests';
import { OrganizationApiKeys } from '../components/OrganizationApiKeys';
import { OrganizationMembers } from '../components/OrganizationMembers';
import { useOrganizations, useRefreshOrganizations } from '../hooks/useOrganizations';

const STATUS_TONES: Record<string, BadgeTone> = {
  approved: 'green',
  pending: 'yellow',
  rejected: 'red',
};

const STATUSES = ['pending', 'approved', 'rejected'] as const;
const isKnownStatus = (status: string): status is (typeof STATUSES)[number] =>
  (STATUSES as readonly string[]).includes(status);

const DetailsForm = ({ org }: { org: OrganizationOut }) => {
  const { t } = useTranslation(['organizations', 'common']);
  const refreshOrganizations = useRefreshOrganizations();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? '');
  const [nameError, setNameError] = useState<string | null>(null);

  const save = useMutation({
    ...updateOrganizationMutation(),
    meta: { errorMessage: t('page.saveFailed'), showUser: false },
    onSuccess: () => {
      void refreshOrganizations();
      setEditing(false);
    },
  });

  const saving = save.isPending;
  const error = nameError ?? (save.error && extractErrorMessage(save.error)) ?? null;

  const startEditing = () => {
    setName(org.name);
    setDescription(org.description ?? '');
    setNameError(null);
    save.reset();
    setEditing(true);
  };

  const submit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError(t('page.nameRequired'));
      return;
    }
    setNameError(null);
    save.mutate({
      path: { organization_id: org.id },
      body: { name: trimmedName, description: description.trim() || null },
    });
  };

  if (!editing) {
    return (
      <div className="surface surface-section flex items-start justify-between gap-4">
        <div>
          <h2 className="section-heading">{t('page.details')}</h2>
          <p className="section-description">{t('page.detailsDescription')}</p>
          <p className="text-sm text-neutral-600 mt-2">
            {org.description || t('page.noDescription')}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={startEditing}>
          {t('common:actions.edit')}
        </Button>
      </div>
    );
  }

  return (
    <div className="surface surface-section space-y-4">
      <h2 className="section-heading">{t('page.details')}</h2>
      <div className="space-y-4 max-w-xl">
        <Field label={t('page.name')} htmlFor="org-edit-name" required error={error}>
          <Input
            id="org-edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(error)}
            disabled={saving}
          />
        </Field>
        <Field label={t('page.description')} htmlFor="org-edit-description">
          <Textarea
            id="org-edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
          />
        </Field>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={saving}>
            {saving ? t('page.saving') : t('common:actions.save')}
          </Button>
          <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const OrganizationPage = () => {
  const { t } = useTranslation('organizations');
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const { orgId } = useParams();
  const organizationId = Number(orgId);
  const { orgs, loading, error } = useOrganizations();
  const refreshOrganizations = useRefreshOrganizations();

  const org = orgs.find((o) => o.id === organizationId);

  useEffect(() => {
    setBreadcrumbs([{ label: org?.name ?? t('page.breadcrumb') }]);
  }, [setBreadcrumbs, org?.name, t]);

  if (!loading && !org && error) {
    return (
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              <h1 className="page-title">{t('page.title')}</h1>
              <p className="page-subtitle">
                {t('page.loadError', { error: extractErrorMessage(error) })}
              </p>
            </div>
          </header>
          <Button variant="secondary" onClick={() => refreshOrganizations()}>
            {t('page.tryAgain')}
          </Button>
        </FadeIn>
      </div>
    );
  }

  if (!loading && (!org || !org.is_admin)) {
    return (
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              <h1 className="page-title">{t('page.title')}</h1>
              <p className="page-subtitle">{t('page.notAdmin')}</p>
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
            {org ? (
              <div className="flex items-center gap-2">
                <h1 className="page-title">{org.name}</h1>
                <Badge tone={STATUS_TONES[org.status] ?? 'neutral'} className="capitalize">
                  {isKnownStatus(org.status) ? t(`status.${org.status}`) : org.status}
                </Badge>
              </div>
            ) : (
              <Skeleton className="h-7 w-52" />
            )}
          </div>
        </header>

        {org ? (
          <>
            <DetailsForm org={org} />
            <AccessRequests organizationId={org.id} />
            <OrganizationApiKeys organizationId={org.id} />
            <OrganizationMembers organizationId={org.id} />
          </>
        ) : (
          <SkeletonForm sections={2} />
        )}
      </FadeIn>
    </div>
  );
};
