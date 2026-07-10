import { useState, useEffect } from 'react';
import type { TaskSetOut } from '~/api/client';
import { Button } from '~/shared/ui/forms';

interface Props {
  isOpen: boolean;
  taskSets: TaskSetOut[];
  numTasks: number;
  onMove: (taskSetId: number) => Promise<void>;
  onCreateSet: (name: string) => Promise<number | null>;
  onCancel: () => void;
  // The set the admin is currently scoped into; moving there is a no-op, so hide it.
  excludeSetId?: number;
}

export const MoveTasksDialog = ({
  isOpen,
  taskSets,
  numTasks,
  onMove,
  onCreateSet,
  onCancel,
  excludeSetId,
}: Props) => {
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
          Move {numTasks} task(s) to another set
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
            Select target set
          </option>
          {taskSets
            .filter((s) => s.id !== excludeSetId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.num_tasks} tasks)
              </option>
            ))}
        </select>
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-neutral-200" />
          <span className="text-xs text-neutral-500">or create a new set</span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>
        <input
          type="text"
          value={newSetName}
          onChange={(e) => {
            setNewSetName(e.target.value);
            setTargetId('');
          }}
          placeholder="New set name"
          className="w-full h-9 px-2 border border-neutral-300 rounded-md text-sm bg-white"
          data-testid="move-new-set-name"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={moving}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!canMove || moving}>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </div>
      </div>
    </div>
  );
};
