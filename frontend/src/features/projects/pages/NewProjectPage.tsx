import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProjectMutation, listProjectsQueryKey } from '~/api/queries';
import { newOrganizationPath, projectPath, projectsPath } from '~/app/routes';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useOrgStore } from '~/shared/stores/org.store';
import { Button, Field, Input, Select, Textarea } from '~/shared/ui/forms';
import { IconPlus } from '~/shared/ui/Icons';
import { FadeIn } from '~/shared/ui/motion';
import { SkeletonForm } from '~/shared/ui/Skeleton';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import {
  useOrganizations,
  useRefreshOrganizations,
} from '~/features/organizations/hooks/useOrganizations';
import { ProjectVisibilityPicker } from '../components/ProjectVisibilityPicker';
import { type ProjectVisibility } from '../components/projectVisibility';

export const NewProjectPage = () => {
  const { t } = useTranslation(['projects', 'common']);
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const queryClient = useQueryClient();
  const { orgs: organizations, loading, error } = useOrganizations({ approvedOnly: true });
  const refreshOrganizations = useRefreshOrganizations();

  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ProjectVisibility>('private');

  const create = useMutation({
    ...createProjectMutation(),
    meta: { errorMessage: t('new.createFailed') },
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: listProjectsQueryKey() });
      showAlert(t('new.created'), 'success');
      navigate(project ? projectPath(project.id) : projectsPath());
    },
  });
  const submitting = create.isPending;

  useEffect(() => {
    setBreadcrumbs([
      { label: t('breadcrumb'), path: projectsPath() },
      { label: t('new.breadcrumb') },
    ]);
  }, [setBreadcrumbs, t]);

  useEffect(() => {
    if (organizations.length === 0) return;
    setOrganizationId((current) => {
      if (current !== null && organizations.some((org) => org.id === current)) return current;
      const active = organizations.find((org) => org.id === activeOrgId);
      return active ? active.id : organizations[0].id;
    });
  }, [organizations, activeOrgId]);

  const handleSubmit = () => {
    if (organizationId === null || !name.trim() || submitting) return;
    create.mutate({
      body: {
        organization_id: organizationId,
        name: name.trim(),
        description: description.trim() || null,
        visibility,
      },
    });
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

        {loading ? (
          <SkeletonForm sections={2} />
        ) : organizations.length === 0 && error ? (
          <div className="surface">
            <div className="surface-section text-center py-16">
              <p className="text-base text-neutral-800 font-medium mb-1">
                {t('new.orgsLoadFailedTitle')}
              </p>
              <p className="text-sm text-neutral-500 mb-5">
                {extractErrorMessage(error, t('new.orgsLoadFailed'))}
              </p>
              <Button variant="secondary" onClick={() => refreshOrganizations()}>
                {t('new.tryAgain')}
              </Button>
            </div>
          </div>
        ) : organizations.length === 0 ? (
          <div className="surface">
            <div className="surface-section text-center py-16">
              <p className="text-base text-neutral-800 font-medium mb-1">{t('new.noOrgTitle')}</p>
              <p className="text-sm text-neutral-500 mb-5">{t('new.noOrgBody')}</p>
              <Button
                onClick={() => navigate(newOrganizationPath())}
                leading={<IconPlus className="w-4 h-4" />}
              >
                {t('new.newOrganization')}
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
              <Field label={t('new.organization')} htmlFor="project-organization" required>
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

              <Field label={t('new.name')} htmlFor="project-name" required>
                <Input
                  id="project-name"
                  placeholder={t('new.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <Field label={t('new.description')} htmlFor="project-description">
                <Textarea
                  id="project-description"
                  placeholder={t('new.descriptionPlaceholder')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>

              <Field label={t('new.visibility')}>
                <ProjectVisibilityPicker value={visibility} onChange={setVisibility} />
              </Field>
            </div>

            <div className="surface-section flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => navigate(projectsPath())}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? t('new.creating') : t('new.create')}
              </Button>
            </div>
          </form>
        )}
      </FadeIn>
    </div>
  );
};
