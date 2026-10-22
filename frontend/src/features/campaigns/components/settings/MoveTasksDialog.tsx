import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSetOut } from '~/api/client';
import { Button } from '~/shared/ui/forms';

interface Props {
  isOpen: boolean;
  taskSets: TaskSetOut[];
  numTasks: number;
  onMove: (taskSetId: number) => Promise<void>;
  onCreateSet: (name: string) => Promise<number | null>;
  onCancel: () => void;
}

export const MoveTasksDialog = ({
  isOpen,
  taskSets,
  numTasks,
  onMove,
  onCreateSet,
  onCancel,
}: Props) => {
  const { t } = useTranslation(['campaigns', 'common']);
  const [targetId, setTargetId] = useState<number | ''>('');
  const [newSetName, setNewSetName] = useState('');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setTargetId('');
      setNewSetName('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const trimmedNewSetName = newSetName.trim();
  const canMove = targetId !== '' || trimmedNewSetName !== '';

  const handleMove = async () => {
    setMoving(true);
    try {
      if (trimmedNewSetName !== '') {
        const createdId = await onCreateSet(trimmedNewSetName);
        if (createdId === null) return;
        await onMove(createdId);
      } else if (targetId !== '') {
        await onMove(targetId);
      }
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-white rounded-lg shadow-xl p-5 w-96 space-y-4"
        data-testid="move-tasks-dialog"
      >
        <h3 className="text-md font-semibold text-neutral-900">
          {t('moveTasks.title', { count: numTasks })}
        </h3>
        <select
          value={targetId}
          onChange={(e) => {
            setTargetId(Number(e.target.value));
            setNewSetName('');
          }}
          className="w-full h-9 px-2 border border-neutral-300 rounded-md text-sm bg-white"
          data-testid="move-target-set"
        >
          <option value="" disabled>
            {t('moveTasks.selectTarget')}
          </option>
          {taskSets.map((s) => (
            <option key={s.id} value={s.id}>
              {t('moveTasks.setOption', { name: s.name, count: s.num_tasks })}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-neutral-200" />
          <span className="text-xs text-neutral-500">{t('moveTasks.orCreate')}</span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>
        <input
          type="text"
          value={newSetName}
          onChange={(e) => {
            setNewSetName(e.target.value);
            setTargetId('');
          }}
          placeholder={t('moveTasks.newSetPlaceholder')}
          className="w-full h-9 px-2 border border-neutral-300 rounded-md text-sm bg-white"
          data-testid="move-new-set-name"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={moving}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleMove} disabled={!canMove || moving}>
            {moving ? t('moveTasks.moving') : t('moveTasks.move')}
          </Button>
        </div>
      </div>
    </div>
  );
};
