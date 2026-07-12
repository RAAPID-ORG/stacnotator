import { useState, useEffect } from 'react';
import type { CampaignUserOut } from '~/api/client';
import { Button } from '~/shared/ui/forms';

type AssignSelectedMode = 'every-user-every-task' | 'distribute-evenly';

interface Props {
  isOpen: boolean;
  numTasks: number;
  campaignUsers: CampaignUserOut[];
  taskIds: number[];
  onAssign: (mapping: Record<number, string[]>) => Promise<void>;
  onCancel: () => void;
}

export const AssignSelectedModal = ({
  isOpen,
  numTasks,
  campaignUsers,
  taskIds,
  onAssign,
  onCancel,
}: Props) => {
  const [mode, setMode] = useState<AssignSelectedMode>('every-user-every-task');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setMode('every-user-every-task');
      setSelectedUsers([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const buildMapping = (): Record<number, string[]> => {
    if (mode === 'every-user-every-task') {
      return Object.fromEntries(taskIds.map((taskId) => [taskId, selectedUsers]));
    }
    return Object.fromEntries(
      taskIds.map((taskId, index) => [taskId, [selectedUsers[index % selectedUsers.length]]])
    );
  };

  const handleAssign = async () => {
    if (selectedUsers.length === 0) return;
    try {
      setAssigning(true);
      await onAssign(buildMapping());
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        data-testid="assign-selected-dialog"
      >
        <div className="px-6 py-4 border-b border-neutral-300">
          <h3 className="text-md font-semibold text-neutral-900">
            Assign {numTasks} selected task(s)
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Assignment mode
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-neutral-700">
                <input
                  type="radio"
                  name="assign-selected-mode"
                  checked={mode === 'every-user-every-task'}
                  onChange={() => setMode('every-user-every-task')}
                />
                Every selected user on every task
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-neutral-700">
                <input
                  type="radio"
                  name="assign-selected-mode"
                  checked={mode === 'distribute-evenly'}
                  onChange={() => setMode('distribute-evenly')}
                />
                Distribute tasks evenly among selected users
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">Select users</label>
            <div className="space-y-2 max-h-72 overflow-y-auto border border-neutral-300 rounded-lg p-3">
              {campaignUsers.map((user) => (
                <label
                  key={user.user.id}
                  className="flex items-center gap-3 p-2 bg-neutral-50 rounded-lg cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedUsers.includes(user.user.id)}
                    onChange={() => handleToggleUser(user.user.id)}
                  />
                  <div>
                    <div className="font-medium text-neutral-900 text-sm">
                      {user.user.display_name}
                    </div>
                    <div className="text-xs text-neutral-500">{user.user.email}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-300 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={assigning}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={selectedUsers.length === 0 || assigning}>
            {assigning ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </div>
    </div>
  );
};
