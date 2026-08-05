import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Input, Switch, Textarea } from '~/shared/ui/forms';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { AnimatedDialog } from '~/shared/ui/motion';
import { Spinner } from '~/shared/ui/Spinner';
import { IconWarning } from '~/shared/ui/Icons';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { projectsPath } from '~/app/routes';
import { deleteProject, updateProject, type ProjectOut } from '~/api/client';

interface ProjectSettingsSectionProps {
  project: ProjectOut;
  onUpdated: (project: ProjectOut) => void;
}

const GO_PRIVATE_WARNING =
  'Making the project private strips public-audience permissions from its campaigns.';

export const ProjectSettingsSection = ({ project, onUpdated }: ProjectSettingsSectionProps) => {
  const navigate = useNavigate();
  const showAlert = useLayoutStore((state) => state.showAlert);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmGoPrivate, setConfirmGoPrivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
  }, [project.name, project.description]);

  const detailsDirty =
    name.trim() !== project.name || description.trim() !== (project.description ?? '');

  const applyUpdate = async (
    body: { name?: string; description?: string; is_public?: boolean },
    successMessage: string
  ) => {
    try {
      setSaving(true);
      const { data } = await updateProject({ path: { project_id: project.id }, body });
      if (data) onUpdated(data);
      showAlert(successMessage, 'success');
    } catch (err) {
      handleError(err, 'Failed to update project');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDetails = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showAlert('Project name cannot be empty', 'error');
      return;
    }
    await applyUpdate(
      { name: trimmed, description: description.trim() },
      'Project details updated'
    );
  };

  const handleVisibilityChange = async (isPublic: boolean) => {
    if (!isPublic) {
      setConfirmGoPrivate(true);
      return;
    }
    await applyUpdate({ is_public: true }, 'Project is now public');
  };

  const handleConfirmGoPrivate = async () => {
    setConfirmGoPrivate(false);
    await applyUpdate({ is_public: false }, 'Project is now private');
  };

  const handleDelete = async () => {
    try {
      setSaving(true);
      await deleteProject({ path: { project_id: project.id } });
      setConfirmDelete(false);
      showAlert('Project deleted', 'success');
      navigate(projectsPath());
    } catch (err) {
      handleError(err, 'Failed to delete project');
    } finally {
      setSaving(false);
    }
  };

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
            Public projects are visible to every signed-in user. {GO_PRIVATE_WARNING}
          </p>
        </div>
        <Switch
          checked={project.is_public}
          onChange={handleVisibilityChange}
          disabled={saving}
          label={project.is_public ? 'Public project' : 'Private project'}
          aria-label="Public project"
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
        isOpen={confirmGoPrivate}
        title="Make project private?"
        description={GO_PRIVATE_WARNING}
        confirmText="Make private"
        isDangerous
        isLoading={saving}
        onConfirm={handleConfirmGoPrivate}
        onCancel={() => setConfirmGoPrivate(false)}
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
