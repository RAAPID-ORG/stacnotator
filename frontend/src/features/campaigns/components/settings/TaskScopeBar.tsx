import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSetOut } from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { IconCheck, IconClose, IconLock, IconPencil, IconTrash } from '~/shared/ui/Icons';

export type TaskScope = 'all' | number;

interface Props {
  scope: TaskScope;
  taskSets: TaskSetOut[];
  totalTasks: number;
  onSelect: (scope: TaskScope) => void;
  /** Omitted for a viewer who may read the sets but not change them. */
  onCreateSet?: (name: string) => Promise<number | null>;
  onRenameSet?: (id: number, name: string) => Promise<void>;
  onDeleteSet?: (id: number) => Promise<boolean>;
  /** Sets owned by another feature, which nothing here may rename or delete. */
  lockedSetIds?: ReadonlySet<number>;
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
  lockedSetIds,
}: Props) => {
  const { t } = useTranslation(['campaigns', 'common', 'areaEstimation']);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TaskSetOut | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canDelete = taskSets.length > 1;

  const cancelCreate = () => {
    setNewName('');
    setCreating(false);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const id = await onCreateSet?.(name);
      if (id != null) {
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
    if (name && name !== set.name) await onRenameSet?.(set.id, name);
    setRenamingId(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const deleted = await onDeleteSet?.(deleteTarget.id);
      if (deleted) onSelect('all');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="task-scope-bar">
      <button type="button" className={pillCls(scope === 'all')} onClick={() => onSelect('all')}>
        {t('taskScope.allTasks')} <span className="opacity-70 tabular-nums">({totalTasks})</span>
      </button>
      {taskSets.map((set) => {
        const active = scope === set.id;
        const locked = lockedSetIds?.has(set.id) ?? false;
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
            {locked && (
              <span
                className="opacity-70"
                title={t('areaEstimation:lockedTaskSetReason')}
                aria-label={t('taskScope.managedSet')}
              >
                <IconLock className="w-3.5 h-3.5" />
              </span>
            )}
            {active && !locked && onRenameSet && onDeleteSet && (
              <>
                <button
                  type="button"
                  className="opacity-70 hover:opacity-100"
                  title={t('taskScope.renameSet')}
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
                  title={canDelete ? t('taskScope.deleteSet') : t('taskScope.needsOneSet')}
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
      {!onCreateSet ? null : creating ? (
        <span className="flex items-center gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') cancelCreate();
            }}
            placeholder={t('taskScope.setNamePlaceholder')}
            className="h-8 px-3 border border-brand-400 rounded-full text-sm"
            autoFocus
          />
          <button
            type="button"
            className="h-8 w-8 flex items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:hover:bg-brand-600"
            title={t('taskScope.createSet')}
            aria-label={t('taskScope.createSet')}
            onClick={handleCreate}
            disabled={!newName.trim() || saving}
          >
            <IconCheck className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="h-8 w-8 flex items-center justify-center rounded-full border border-neutral-200 text-neutral-500 hover:text-neutral-800 hover:border-neutral-300"
            title={t('common:actions.cancel')}
            aria-label={t('taskScope.cancelCreate')}
            onClick={cancelCreate}
          >
            <IconClose className="w-4 h-4" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={`${pillCls(false)} border-dashed`}
          onClick={() => setCreating(true)}
          data-testid="scope-new-set"
        >
          {t('taskScope.newSet')}
        </button>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t('taskScope.deleteTitle', { name: deleteTarget?.name })}
        description={t('taskScope.deleteDescription', { count: deleteTarget?.num_tasks ?? 0 })}
        confirmText={t('common:actions.delete')}
        cancelText={t('common:actions.cancel')}
        isDangerous
        isLoading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
