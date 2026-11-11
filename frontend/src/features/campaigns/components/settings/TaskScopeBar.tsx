import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSetOut } from '~/api/client';
import { BarButton } from '~/shared/ui/BarButton';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { IconLock, IconPencil, IconTrash } from '~/shared/ui/Icons';
import { InlineAddAction } from '~/shared/ui/InlineAddAction';
import { Modal } from '~/shared/ui/Modal';
import { TabNavigator } from '~/shared/ui/TabNavigator';
import { Button, Input } from '~/shared/ui/forms';

export type TaskScope = 'all' | number;

interface Props {
  scope: TaskScope;
  taskSets: TaskSetOut[];
  totalTasks: number;
  onSelect: (scope: TaskScope) => void;
  onCreateSet?: (name: string) => Promise<number | null>;
  onRenameSet?: (id: number, name: string) => Promise<void>;
  onDeleteSet?: (id: number) => Promise<boolean>;
  lockedSetIds?: ReadonlySet<number>;
}

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
  const [editing, setEditing] = useState<'create' | TaskSetOut | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskSetOut | null>(null);
  const [deleting, setDeleting] = useState(false);
  const selectedSet = taskSets.find((set) => set.id === scope);
  const canEdit = selectedSet && !lockedSetIds?.has(selectedSet.id);
  const canDelete = taskSets.length > 1;

  const closeEditor = () => {
    if (!saving) setEditing(null);
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving || !editing) return;
    setSaving(true);
    try {
      if (editing === 'create') {
        const id = await onCreateSet?.(trimmed);
        if (id == null) return;
        onSelect(id);
      } else if (trimmed !== editing.name) {
        await onRenameSet?.(editing.id, trimmed);
      }
      setEditing(null);
    } catch {
      // The page's mutation reports the error; keep the name available to retry.
    } finally {
      setSaving(false);
    }
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

  const items = [
    { id: 'all', name: t('taskScope.allTasks'), count: totalTasks, locked: false },
    ...taskSets.map((set) => ({
      id: String(set.id),
      name: set.name,
      count: set.num_tasks,
      locked: lockedSetIds?.has(set.id) ?? false,
    })),
  ];

  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="task-scope-bar">
      <TabNavigator
        size="bar"
        label={t('overview.taskSets')}
        panelId="task-scope-content"
        activeId={String(scope)}
        onChange={(id) => onSelect(id === 'all' ? 'all' : Number(id))}
        items={items.map((item) => ({
          id: item.id,
          label: (
            <span className="flex items-center gap-2">
              <span className="max-w-48 truncate" title={item.name}>
                {item.name}
              </span>{' '}
              <span className="text-[11px] font-normal tabular-nums text-neutral-400">
                {item.count}
              </span>
              {item.locked && (
                <span
                  title={t('areaEstimation:lockedTaskSetReason')}
                  aria-label={t('taskScope.managedSet')}
                >
                  <IconLock className="h-3 w-3 text-neutral-400" />
                </span>
              )}
            </span>
          ),
        }))}
      />
      {(onCreateSet || (canEdit && (onRenameSet || onDeleteSet))) && (
        <div className="flex shrink-0 items-center gap-1 border-l border-neutral-200 pl-2">
          {canEdit && onRenameSet && (
            <BarButton
              icon={IconPencil}
              title={t('taskScope.renameSet')}
              aria-label={t('taskScope.renameSet')}
              onClick={() => {
                setName(selectedSet.name);
                setEditing(selectedSet);
              }}
            />
          )}
          {canEdit && onDeleteSet && (
            <BarButton
              icon={IconTrash}
              title={canDelete ? t('taskScope.deleteSet') : t('taskScope.needsOneSet')}
              aria-label={t('taskScope.deleteSet')}
              disabled={!canDelete}
              onClick={() => setDeleteTarget(selectedSet)}
            />
          )}
          {onCreateSet && (
            <InlineAddAction
              className="mx-2 whitespace-nowrap"
              onClick={() => {
                setName('');
                setEditing('create');
              }}
            >
              {t('taskScope.newSet')}
            </InlineAddAction>
          )}
        </div>
      )}

      {editing && (
        <Modal
          title={editing === 'create' ? t('taskScope.newSet') : t('taskScope.renameSet')}
          onClose={closeEditor}
        >
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <Input
              autoFocus
              aria-label={t('taskScope.setNamePlaceholder')}
              placeholder={t('taskScope.setNamePlaceholder')}
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeEditor();
              }}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={saving} onClick={closeEditor}>
                {t('common:actions.cancel')}
              </Button>
              <Button size="sm" type="submit" disabled={!name.trim() || saving}>
                {editing === 'create' ? t('taskScope.createSet') : t('common:actions.save')}
              </Button>
            </div>
          </form>
        </Modal>
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
