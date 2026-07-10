import { useState } from 'react';
import type { TaskSetOut } from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';

interface Props {
  set: TaskSetOut;
  doneCount: number;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  canDelete: boolean;
}

export const TaskSetHeader = ({ set, doneCount, onRename, onDelete, canDelete }: Props) => {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(set.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const progress = set.num_tasks > 0 ? Math.round((doneCount / set.num_tasks) * 100) : 0;

  const handleRename = async () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== set.name) await onRename(set.id, trimmed);
    setRenaming(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(set.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div
      className="rounded-lg border-l-4 border border-brand-300 border-l-brand-600 bg-brand-50/40 px-4 py-3"
      data-testid="task-set-header"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-brand-700 font-semibold">
          Task set
        </span>
        {renaming ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={handleRename}
            className="h-8 px-2 border border-neutral-300 rounded text-sm font-medium"
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="text-base font-semibold text-neutral-900 hover:underline"
            onClick={() => {
              setName(set.name);
              setRenaming(true);
            }}
            title="Rename set"
          >
            {set.name}
          </button>
        )}
        <span className="text-sm text-neutral-600 tabular-nums">
          {doneCount}/{set.num_tasks} done
        </span>
        <div className="w-32 h-1.5 rounded bg-neutral-200 overflow-hidden">
          <div className="h-full bg-brand-600" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-neutral-500">
          created {new Date(set.created_at).toLocaleDateString()}
        </span>
        <button
          type="button"
          className="ml-auto text-xs text-neutral-400 hover:text-red-600 disabled:opacity-40"
          disabled={!canDelete}
          title={canDelete ? undefined : 'A campaign needs at least one task set'}
          onClick={() => setConfirmDelete(true)}
        >
          Delete set
        </button>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        title={`Delete task set "${set.name}"?`}
        description={`This permanently deletes the set and its ${set.num_tasks} task(s) with all associated annotations. This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous
        isLoading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
};
