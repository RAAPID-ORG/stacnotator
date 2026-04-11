import { useState, useMemo } from 'react';
import type { AnnotationTaskOut, CampaignUserOut } from '~/api/client';

interface TaskAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: AnnotationTaskOut[];
  campaignUsers: CampaignUserOut[];
  onAssign: (assignments: { [taskId: number]: string[] }) => Promise<void>;
}

type AssignmentMode = 'random-all' | 'random-count';

export const TaskAssignmentModal = ({
  isOpen,
  onClose,
  tasks,
  campaignUsers,
  onAssign,
}: TaskAssignmentModalProps) => {
  const [mode, setMode] = useState<AssignmentMode>('random-all');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [tasksPerUser, setTasksPerUser] = useState<{ [userId: string]: number }>({});
  const [assigning, setAssigning] = useState(false);

  const unassignedTasks = useMemo(
    () => tasks.filter((t) => !t.assignments || t.assignments.length === 0),
    [tasks]
  );

  const handleToggleUser = (userId: string) => {
    setSelectedUsers((prev) => {
      const newUsers = prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId];

      if (!prev.includes(userId)) {
        setTasksPerUser((tpu) => ({ ...tpu, [userId]: 10 }));
      }

      return newUsers;
    });
  };

  const handleSelectAllUsers = () => {
    if (selectedUsers.length === campaignUsers.length) {
      setSelectedUsers([]);
    } else {
      const allUserIds = campaignUsers.map((u) => u.user.id);
      setSelectedUsers(allUserIds);
      const newTasksPerUser: { [userId: string]: number } = {};
      allUserIds.forEach((id) => {
        newTasksPerUser[id] = tasksPerUser[id] || 10;
      });
      setTasksPerUser(newTasksPerUser);
    }
  };

  const handleTasksPerUserChange = (userId: string, count: number) => {
    setTasksPerUser((prev) => ({ ...prev, [userId]: Math.max(1, count) }));
  };

  const generateAssignments = (): { [taskId: number]: string[] } => {
    const assignments: { [taskId: number]: string[] } = {};

    if (mode === 'random-all') {
      if (selectedUsers.length === 0) return assignments;

      unassignedTasks.forEach((task, index) => {
        const userIndex = index % selectedUsers.length;
        assignments[task.id] = [selectedUsers[userIndex]];
      });
    } else if (mode === 'random-count') {
      if (selectedUsers.length === 0) return assignments;

      const shuffled = [...unassignedTasks].sort(() => Math.random() - 0.5);
      let taskIndex = 0;

      selectedUsers.forEach((userId) => {
        const count = tasksPerUser[userId] || 10;
        for (let i = 0; i < count && taskIndex < shuffled.length; i++) {
          const task = shuffled[taskIndex];
          if (!assignments[task.id]) {
            assignments[task.id] = [];
          }
          assignments[task.id].push(userId);
          taskIndex++;
        }
      });
    }

    return assignments;
  };

  const handleAssign = async () => {
    const assignments = generateAssignments();
    if (Object.keys(assignments).length === 0) {
      return;
    }

    try {
      setAssigning(true);
      await onAssign(assignments);
      onClose();
      setSelectedUsers([]);
      setTasksPerUser({});
    } catch (err) {
      console.error('Assignment failed', err);
    } finally {
      setAssigning(false);
    }
  };

  const previewAssignmentCount = useMemo(() => {
    return Object.keys(generateAssignments()).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generateAssignments depends on mode, selectedUsers, tasksPerUser, unassignedTasks
  }, [mode, selectedUsers, tasksPerUser, unassignedTasks]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-neutral-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-neutral-300">
          <h2 className="text-xl font-semibold text-neutral-900">Assign Tasks to Users</h2>
          <p className="text-sm text-neutral-500 mt-1">
            {unassignedTasks.length} unassigned tasks available
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Mode Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Assignment Mode
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setMode('random-all')}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  mode === 'random-all'
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                Assign All Random
              </button>
              <button
                onClick={() => setMode('random-count')}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  mode === 'random-count'
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                N Tasks per User
              </button>
            </div>
          </div>

          {/* Random All / Random Count Mode */}
          {(mode === 'random-all' || mode === 'random-count') && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Select Users {mode === 'random-count' && 'and Task Counts'}
              </label>
              <button
                onClick={handleSelectAllUsers}
                className="text-sm text-brand-700 hover:text-brand-600 mb-3"
              >
                {selectedUsers.length === campaignUsers.length ? 'Deselect All' : 'Select All'}
              </button>

              <div className="space-y-2 max-h-96 overflow-y-auto border border-neutral-300 rounded-lg p-3">
                {campaignUsers.map((user) => (
                  <div
                    key={user.user.id}
                    className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg"
                  >
                    <label className="flex items-center cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.user.id)}
                        onChange={() => handleToggleUser(user.user.id)}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium text-neutral-900">{user.user.display_name}</div>
                        <div className="text-sm text-neutral-500">{user.user.email}</div>
                        {user.is_admin && (
                          <span className="text-xs text-brand-700 font-semibold">Admin</span>
                        )}
                        {user.is_authorative_reviewer && (
                          <span className="text-xs text-purple-500 font-semibold ml-2">
                            Authoritative Reviewer
                          </span>
                        )}
                      </div>
                    </label>

                    {mode === 'random-count' && selectedUsers.includes(user.user.id) && (
                      <div className="flex items-center gap-2 ml-4">
                        <label className="text-sm text-neutral-600 whitespace-nowrap">Tasks:</label>
                        <input
                          type="number"
                          min="1"
                          max={unassignedTasks.length}
                          value={tasksPerUser[user.user.id] || 10}
                          onChange={(e) =>
                            handleTasksPerUserChange(user.user.id, Number(e.target.value))
                          }
                          className="w-20 px-2 py-1 border border-neutral-300 rounded text-sm"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {previewAssignmentCount > 0 && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Preview:</strong> Will assign {previewAssignmentCount} tasks
                {mode === 'random-all' && ` evenly distributed to ${selectedUsers.length} user(s)`}
                {mode === 'random-count' && ` to ${selectedUsers.length} user(s)`}
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-neutral-300 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={assigning}
            className="px-4 py-2 border border-neutral-300 rounded-lg text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={assigning || previewAssignmentCount === 0}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {assigning ? 'Assigning...' : `Assign ${previewAssignmentCount} Tasks`}
          </button>
        </div>
      </div>
    </div>
  );
};
