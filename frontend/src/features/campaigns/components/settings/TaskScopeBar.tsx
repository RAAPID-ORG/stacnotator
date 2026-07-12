import { useState } from 'react';
import type { TaskSetOut } from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { IconPencil, IconTrash } from '~/shared/ui/Icons';

export type TaskScope = 'all' | number;

interface Props {
  scope: TaskScope;
  taskSets: TaskSetOut[];
  totalTasks: number;
  onSelect: (scope: TaskScope) => void;
  onCreateSet: (name: string) => Promise<number | null>;
  onRenameSet: (id: number, name: string) => Promise<void>;
  onDeleteSet: (id: number) => Promise<boolean>;
}

import { pillCls } from '~/shared/ui/pill';

export const TaskScopeBar = ({
  scope,
  taskSets,
  totalTasks,
  onSelect,
  onCreateSet,
  onRenameSet,
  onDeleteSet,
}: Props) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TaskSetOut | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canDelete = taskSets.length > 1;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const id = await onCreateSet(name);
      if (id !== null) {
        setNewName('');
        setCreating(false);
        onSelect(id);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (set: TaskSetOut) => {
    const name = renameValue.trim();
    if (name && name !== set.name) await onRenameSet(set.id, name);
    setRenamingId(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const deleted = await onDeleteSet(deleteTarget.id);
      if (deleted) onSelect('all');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="task-scope-bar">
      <button type="button" className={pillCls(scope === 'all')} onClick={() => onSelect('all')}>
        All tasks <span className="opacity-70 tabular-nums">({totalTasks})</span>
      </button>
      {taskSets.map((set) => {
        const active = scope === set.id;
        if (renamingId === set.id) {
          return (
            <span key={set.id} className="flex items-center gap-1">
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(set);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onBlur={() => handleRename(set)}
                className="h-8 px-3 border border-brand-400 rounded-full text-sm"
                autoFocus
              />
            </span>
          );
        }
        return (
          <span key={set.id} className={pillCls(active)} data-testid={`scope-set-${set.id}`}>
            <button
              type="button"
              className="flex items-center gap-1.5"
              onClick={() => onSelect(set.id)}
            >
              {set.name} <span className="opacity-70 tabular-nums">({set.num_tasks})</span>
            </button>
            {active && (
              <>
                <button
                  type="button"
                  className="opacity-70 hover:opacity-100"
                  title="Rename set"
                  onClick={() => {
                    setRenameValue(set.name);
                    setRenamingId(set.id);
                  }}
                >
                  <IconPencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className="opacity-70 hover:opacity-100 disabled:opacity-30"
                  title={canDelete ? 'Delete set' : 'A campaign needs at least one task set'}
                  disabled={!canDelete}
                  onClick={() => setDeleteTarget(set)}
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </span>
        );
      })}
      {creating ? (
        <span className="flex items-center gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder="Set name"
            className="h-8 px-2 border border-neutral-300 rounded-full text-sm"
            autoFocus
          />
          <button
            type="button"
            className={pillCls(false)}
            onClick={handleCreate}
            disabled={!newName.trim() || saving}
          >
            Create
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={`${pillCls(false)} border-dashed`}
          onClick={() => setCreating(true)}
          data-testid="scope-new-set"
        >
          + New set
        </button>
      )}

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
