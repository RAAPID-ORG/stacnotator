import { useState } from 'react';
import type { AnnotationTaskOut, TaskSetOut } from '~/api/client';
import { Button } from '~/shared/ui/forms';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';

interface Props {
  taskSets: TaskSetOut[];
  tasks: AnnotationTaskOut[];
  onCreate: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

const doneStatuses = new Set(['done', 'skipped']);

export const TaskSetsSection = ({ taskSets, tasks, onCreate, onRename, onDelete }: Props) => {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TaskSetOut | null>(null);
  const [deleting, setDeleting] = useState(false);

  const doneCount = (setId: number) =>
    tasks.filter((t) => t.task_set_id === setId && doneStatuses.has(t.task_status ?? 'pending'))
      .length;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreate(newName.trim());
      setNewName('');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (id: number) => {
    if (!renameValue.trim()) return;
    await onRename(id, renameValue.trim());
    setRenamingId(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="task-sets-section">
      <div className="flex flex-wrap gap-2">
        {taskSets.map((set) => (
          <div
            key={set.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-200 bg-white text-sm"
            data-testid={`task-set-${set.id}`}
          >
            {renamingId === set.id ? (
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename(set.id)}
                className="h-7 px-2 border border-neutral-300 rounded text-sm"
                autoFocus
              />
            ) : (
              <span className="font-medium text-neutral-800">{set.name}</span>
            )}
            <span className="text-xs text-neutral-500 tabular-nums">
              {doneCount(set.id)}/{set.num_tasks} done
            </span>
            {renamingId === set.id ? (
              <button
                type="button"
                className="text-xs text-brand-700 hover:underline"
                onClick={() => handleRename(set.id)}
              >
                Save
              </button>
            ) : (
              <button
                type="button"
                className="text-xs text-neutral-400 hover:text-neutral-700"
                onClick={() => {
                  setRenamingId(set.id);
                  setRenameValue(set.name);
                }}
              >
                Rename
              </button>
            )}
            <button
              type="button"
              className="text-xs text-neutral-400 hover:text-red-600 disabled:opacity-40"
              disabled={taskSets.length <= 1}
              title={taskSets.length <= 1 ? 'A campaign needs at least one task set' : undefined}
              onClick={() => setDeleteTarget(set)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="New task set name"
          className="h-8 px-2 border border-neutral-300 rounded-md text-sm"
        />
        <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
          Add set
        </Button>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={`Delete task set "${deleteTarget?.name}"?`}
        description={`This permanently deletes the set and its ${deleteTarget?.num_tasks ?? 0} task(s) with all associated annotations. This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous
        isLoading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
