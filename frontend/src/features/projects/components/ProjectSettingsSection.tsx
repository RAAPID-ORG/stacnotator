import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Textarea } from '~/shared/ui/forms';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { AnimatedDialog } from '~/shared/ui/motion';
import { Spinner } from '~/shared/ui/Spinner';
import { IconWarning } from '~/shared/ui/Icons';
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
    meta: { errorMessage: 'Failed to update project' },
    onSuccess: invalidateProject,
  });

  const remove = useMutation({
    ...deleteProjectMutation(),
    meta: { errorMessage: 'Failed to delete project' },
    onSuccess: () => {
      setConfirmDelete(false);
      void queryClient.invalidateQueries({ queryKey: listProjectsQueryKey() });
      showAlert('Project deleted', 'success');
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
      showAlert('Project name cannot be empty', 'error');
      return;
    }
    applyUpdate({ name: trimmed, description: description.trim() }, 'Project details updated');
  };

  const visibilityMessage = (visibility: ProjectVisibility) =>
    visibility === 'public'
      ? 'Project is now public'
      : visibility === 'organization'
        ? 'Project is now visible to its organization'
        : 'Project is now private';

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
          <h2 className="section-heading">Project details</h2>
          <p className="section-description">The name and description shown across the platform.</p>
        </div>
        <Field label="Name" htmlFor="project-name" required>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
        </Field>
        <Field label="Description" htmlFor="project-description">
          <Textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about?"
            disabled={saving}
          />
        </Field>
        <div>
          <Button onClick={handleSaveDetails} disabled={saving || !detailsDirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Visibility</h2>
          <p className="section-description">
            Who can open this project and work on its campaigns. Changes apply immediately.
          </p>
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
            <h3 className="text-sm font-medium text-neutral-900">Delete project</h3>
            <p className="section-description">
              Deleting a project permanently deletes its campaigns and every annotation in them.
            </p>
          </div>
          <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
            Delete project
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
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (isOpen) setInputValue('');
  }, [isOpen]);

  return (
    <AnimatedDialog
      open={isOpen}
      backdropClassName="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[9999]"
      panelClassName="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 border border-neutral-200"
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <IconWarning className="w-6 h-6 text-red-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">Delete project</h3>
            <div className="text-sm text-neutral-600 space-y-3">
              <p>
                This action <strong>cannot be undone</strong>. It permanently deletes the project{' '}
                <strong className="text-neutral-900">{projectName}</strong>, every campaign inside
                it, and all of their tasks, annotations and settings.
              </p>
              <p className="pt-2">
                Please type <strong className="font-mono text-neutral-900">{projectName}</strong> to
                confirm:
              </p>
            </div>
            <div className="mt-3">
              <Input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isLoading}
                placeholder="Type project name here"
                autoFocus
              />
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-100 flex gap-2 p-4 justify-end bg-neutral-50/50">
        <Button variant="secondary" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          disabled={inputValue !== projectName || isLoading}
          leading={isLoading ? <Spinner size="xs" variant="white" /> : undefined}
        >
          Delete project
        </Button>
      </div>
    </AnimatedDialog>
  );
};
