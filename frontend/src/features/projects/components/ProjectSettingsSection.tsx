import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Textarea } from '~/shared/ui/forms';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { TypeToDeleteDialog } from '~/shared/ui/TypeToDeleteDialog';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { projectsPath } from '~/app/routes';
import { type ProjectOut } from '~/api/client';
import {
  deleteProjectMutation,
  getProjectQueryKey,
  listProjectsQueryKey,
  updateProjectMutation,
} from '~/api/queries';
import { ProjectVisibilityPicker } from './ProjectVisibilityPicker';
import { visibilityConfirm, type ProjectVisibility } from './projectVisibility';

interface ProjectSettingsSectionProps {
  project: ProjectOut;
}

export const ProjectSettingsSection = ({ project }: ProjectSettingsSectionProps) => {
  const { t } = useTranslation('projects');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showAlert = useLayoutStore((state) => state.showAlert);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [pendingVisibility, setPendingVisibility] = useState<ProjectVisibility | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const path = { project_id: project.id };

  // The project itself feeds this form, the page header and the sidebar nav;
  // the list carries the visibility badge. Both go stale on any edit here.
  const invalidateProject = () => {
    void queryClient.invalidateQueries({ queryKey: getProjectQueryKey({ path }) });
    void queryClient.invalidateQueries({ queryKey: listProjectsQueryKey() });
  };

  const update = useMutation({
    ...updateProjectMutation(),
    meta: { errorMessage: t('settings.updateFailed') },
    onSuccess: invalidateProject,
  });

  const remove = useMutation({
    ...deleteProjectMutation(),
    meta: { errorMessage: t('settings.deleteFailed') },
    onSuccess: () => {
      setConfirmDelete(false);
      void queryClient.invalidateQueries({ queryKey: listProjectsQueryKey() });
      showAlert(t('settings.deleted'), 'success');
      navigate(projectsPath());
    },
  });

  const saving = update.isPending || remove.isPending;

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
  }, [project.name, project.description]);

  const detailsDirty =
    name.trim() !== project.name || description.trim() !== (project.description ?? '');

  const applyUpdate = (
    body: { name?: string; description?: string; visibility?: ProjectVisibility },
    successMessage: string
  ) => update.mutate({ path, body }, { onSuccess: () => showAlert(successMessage, 'success') });

  const handleSaveDetails = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showAlert(t('settings.nameEmpty'), 'error');
      return;
    }
    applyUpdate({ name: trimmed, description: description.trim() }, t('settings.detailsUpdated'));
  };

  const visibilityMessage = (visibility: ProjectVisibility) =>
    visibility === 'public'
      ? t('settings.nowPublic')
      : visibility === 'organization'
        ? t('settings.nowOrganization')
        : t('settings.nowPrivate');

  const handleVisibilityChange = (visibility: ProjectVisibility) => {
    if (visibility === project.visibility) return;
    if (visibilityConfirm(project.visibility, visibility)) {
      setPendingVisibility(visibility);
      return;
    }
    applyUpdate({ visibility }, visibilityMessage(visibility));
  };

  const handleConfirmVisibility = () => {
    if (pendingVisibility === null) return;
    const visibility = pendingVisibility;
    setPendingVisibility(null);
    applyUpdate({ visibility }, visibilityMessage(visibility));
  };

  const pendingConfirm =
    pendingVisibility !== null ? visibilityConfirm(project.visibility, pendingVisibility) : null;

  const handleDelete = () => remove.mutate({ path });

  const sectionCls =
    'space-y-4 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  return (
    <div>
      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('settings.detailsTitle')}</h2>
          <p className="section-description">{t('settings.detailsDescription')}</p>
        </div>
        <Field label={t('settings.name')} htmlFor="project-name" required>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
        </Field>
        <Field label={t('settings.description')} htmlFor="project-description">
          <Textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('settings.descriptionPlaceholder')}
            disabled={saving}
          />
        </Field>
        <div>
          <Button onClick={handleSaveDetails} disabled={saving || !detailsDirty}>
            {saving ? t('settings.saving') : t('settings.saveChanges')}
          </Button>
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">{t('settings.visibilityTitle')}</h2>
          <p className="section-description">{t('settings.visibilityDescription')}</p>
        </div>
        <ProjectVisibilityPicker
          value={project.visibility}
          onChange={handleVisibilityChange}
          disabled={saving}
          name="project-visibility-settings"
        />
      </section>

      <section className={sectionCls}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-neutral-900">{t('settings.deleteTitle')}</h3>
            <p className="section-description">{t('settings.deleteDescription')}</p>
          </div>
          <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
            {t('settings.deleteProject')}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        isOpen={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description ?? ''}
        confirmText={pendingConfirm?.confirmText ?? ''}
        isDangerous={pendingConfirm?.isDangerous}
        isLoading={saving}
        onConfirm={handleConfirmVisibility}
        onCancel={() => setPendingVisibility(null)}
      />

      <DeleteProjectDialog
        isOpen={confirmDelete}
        projectName={project.name}
        isLoading={saving}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
};

interface DeleteProjectDialogProps {
  isOpen: boolean;
  projectName: string;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteProjectDialog = ({
  isOpen,
  projectName,
  isLoading,
  onConfirm,
  onCancel,
}: DeleteProjectDialogProps) => {
  const { t } = useTranslation('projects');
  return (
    <TypeToDeleteDialog
      isOpen={isOpen}
      name={projectName}
      title={t('settings.deleteTitle')}
      confirmText={t('settings.deleteProject')}
      isLoading={isLoading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        <Trans
          t={t}
          i18nKey="settings.deleteWarning"
          values={{ name: projectName }}
          components={{ strong: <strong />, name: <strong className="text-neutral-900" /> }}
        />
      </p>
    </TypeToDeleteDialog>
  );
};
