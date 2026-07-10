import { useState } from 'react';
import type { TaskSetOut } from '~/api/client';
import { Button } from '~/shared/ui/forms';

interface Props {
  isOpen: boolean;
  taskSets: TaskSetOut[];
  numTasks: number;
  onMove: (taskSetId: number) => Promise<void>;
  onCancel: () => void;
}

export const MoveTasksDialog = ({ isOpen, taskSets, numTasks, onMove, onCancel }: Props) => {
  const [targetId, setTargetId] = useState<number | ''>('');
  const [moving, setMoving] = useState(false);

  if (!isOpen) return null;

  const handleMove = async () => {
    if (targetId === '') return;
    setMoving(true);
    try {
      await onMove(targetId);
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
          onChange={(e) => setTargetId(Number(e.target.value))}
          className="w-full h-9 px-2 border border-neutral-300 rounded-md text-sm bg-white"
          data-testid="move-target-set"
        >
          <option value="" disabled>
            Select target set
          </option>
          {taskSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.num_tasks} tasks)
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={moving}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={targetId === '' || moving}>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </div>
      </div>
    </div>
  );
};
