import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['organizations', 'common']);
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const setActiveOrgId = useOrgStore((s) => s.setActiveOrgId);
  const refreshOrganizations = useRefreshOrganizations();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [requestedName, setRequestedName] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: t('new.breadcrumb') }]);
  }, [setBreadcrumbs, t]);

  // A platform admin's own request is approved on creation, so the response
  // decides between landing in the new organization and waiting for review.
  const request = useMutation({
    ...requestOrganizationMutation(),
    meta: { errorMessage: t('new.requestFailed'), showUser: false },
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
      setNameError(t('new.nameRequired'));
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
            <h1 className="page-title">{t('new.title')}</h1>
            <p className="page-subtitle">{t('new.subtitle')}</p>
          </div>
        </header>

        {requestedName ? (
          <div className="surface" data-testid="org-request-pending">
            <div className="surface-section space-y-3">
              <p className="text-sm font-medium text-neutral-900">{t('new.awaitingApproval')}</p>
              <p className="text-sm text-neutral-500">
                {t('new.pendingNote', { name: requestedName })}
              </p>
            </div>
            <div className="surface-section flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setRequestedName(null)}>
                {t('new.requestAnother')}
              </Button>
              <Button onClick={() => navigate(projectsPath())}>{t('new.backToProjects')}</Button>
            </div>
          </div>
        ) : (
          <form className="surface" onSubmit={handleSubmit}>
            <div className="surface-section space-y-5">
              <Field label={t('new.name')} htmlFor="org-name" required error={error}>
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
                label={t('new.description')}
                htmlFor="org-description"
                hint={t('new.descriptionHint')}
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
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? t('new.requesting') : t('new.submit')}
              </Button>
            </div>
          </form>
        )}
      </FadeIn>
    </div>
  );
};
