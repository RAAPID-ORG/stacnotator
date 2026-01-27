import { useState, useMemo } from 'react';
import type { AnnotationTaskItemOut, CampaignUserOut } from '~/api/client';

interface TaskAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: AnnotationTaskItemOut[];
  campaignUsers: CampaignUserOut[];
  onAssign: (assignments: { [taskId: number]: string }) => Promise<void>;
}

type AssignmentMode = 'random-all' | 'random-count' | 'specific';

export const TaskAssignmentModal = ({
  isOpen,
  onClose,
  tasks,
  campaignUsers,
  onAssign,
}: TaskAssignmentModalProps) => {
  const [mode, setMode] = useState<AssignmentMode>('random-all');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [tasksPerUser, setTasksPerUser] = useState<number>(10);
  const [specificAssignments, setSpecificAssignments] = useState<{ [taskId: number]: string }>({});
  const [filterTaskIds, setFilterTaskIds] = useState<string>('');
  const [assigning, setAssigning] = useState(false);

  // Get unassigned tasks
  const unassignedTasks = useMemo(
    () => tasks.filter((t) => !t.assigned_user),
    [tasks]
  );

  // Get selected task IDs for specific assignment
  const specificTaskIds = useMemo(() => {
    if (!filterTaskIds.trim()) return [];
    return filterTaskIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id && !isNaN(Number(id)))
      .map(Number);
  }, [filterTaskIds]);

  const handleToggleUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSelectAllUsers = () => {
    if (selectedUsers.length === campaignUsers.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(campaignUsers.map((u) => u.user.id));
    }
  };

  const generateAssignments = (): { [taskId: number]: string } => {
    const assignments: { [taskId: number]: string } = {};

    if (mode === 'random-all') {
      // Assign all unassigned tasks randomly to selected users
      if (selectedUsers.length === 0) return assignments;

      unassignedTasks.forEach((task, index) => {
        const userIndex = index % selectedUsers.length;
        assignments[task.id] = selectedUsers[userIndex];
      });
    } else if (mode === 'random-count') {
      // Assign specific number of tasks per user randomly
      if (selectedUsers.length === 0) return assignments;

      const shuffled = [...unassignedTasks].sort(() => Math.random() - 0.5);
      let taskIndex = 0;

      selectedUsers.forEach((userId) => {
        for (let i = 0; i < tasksPerUser && taskIndex < shuffled.length; i++) {
          assignments[shuffled[taskIndex].id] = userId;
          taskIndex++;
        }
      });
    } else if (mode === 'specific') {
      // Use specific assignments
      return specificAssignments;
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
      // Reset state
      setSelectedUsers([]);
      setSpecificAssignments({});
      setFilterTaskIds('');
    } catch (err) {
      console.error('Assignment failed', err);
    } finally {
      setAssigning(false);
    }
  };

  const handleSpecificAssignment = (taskId: number, userId: string) => {
    setSpecificAssignments((prev) => ({
      ...prev,
      [taskId]: userId,
    }));
  };

  const previewAssignmentCount = useMemo(() => {
    return Object.keys(generateAssignments()).length;
  }, [mode, selectedUsers, tasksPerUser, specificAssignments, unassignedTasks]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-neutral-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-300">
          <h2 className="text-xl font-semibold text-neutral-900">Assign Tasks to Users</h2>
          <p className="text-sm text-neutral-500 mt-1">
            {unassignedTasks.length} unassigned tasks available
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Mode Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Assignment Mode
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setMode('random-all')}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  mode === 'random-all'
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                Assign All Random
              </button>
              <button
                onClick={() => setMode('random-count')}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  mode === 'random-count'
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                Assign N per User
              </button>
              <button
                onClick={() => setMode('specific')}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  mode === 'specific'
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                Specific Assignment
              </button>
            </div>
          </div>

          {/* User Selection (for random modes) */}
          {(mode === 'random-all' || mode === 'random-count') && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-neutral-700">
                  Select Users ({selectedUsers.length} selected)
                </label>
                <button
                  onClick={handleSelectAllUsers}
                  className="text-sm text-brand-600 hover:text-brand-700"
                >
                  {selectedUsers.length === campaignUsers.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="border border-neutral-300 rounded-lg max-h-48 overflow-y-auto">
                {campaignUsers.map((user) => (
                  <label
                    key={user.user.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 cursor-pointer border-b border-neutral-200 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(user.user.id)}
                      onChange={() => handleToggleUser(user.user.id)}
                      className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-neutral-900">{user.user.display_name}</div>
                      <div className="text-xs text-neutral-500">
                        {tasks.filter((t) => t.assigned_user?.id === user.user.id).length} tasks
                        assigned
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Tasks per User (for random-count mode) */}
          {mode === 'random-count' && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Tasks per User
              </label>
              <input
                type="number"
                min="1"
                value={tasksPerUser}
                onChange={(e) => setTasksPerUser(Number(e.target.value))}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <p className="text-xs text-neutral-500 mt-1">
                Total to assign: {Math.min(selectedUsers.length * tasksPerUser, unassignedTasks.length)} tasks
              </p>
            </div>
          )}

          {/* Specific Assignment */}
          {mode === 'specific' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Task IDs (comma-separated, or leave blank for all unassigned)
                </label>
                <input
                  type="text"
                  value={filterTaskIds}
                  onChange={(e) => setFilterTaskIds(e.target.value)}
                  placeholder="e.g., 1, 5, 10-15, 20"
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              <div className="border border-neutral-300 rounded-lg max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-neutral-700">Task ID</th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-700">
                        Annotation #
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-700">
                        Current User
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-700">
                        Assign To
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(specificTaskIds.length > 0
                      ? tasks.filter((t) => specificTaskIds.includes(t.id))
                      : unassignedTasks
                    ).map((task) => (
                      <tr key={task.id} className="border-b border-neutral-200 hover:bg-neutral-50">
                        <td className="px-4 py-2 text-neutral-500">{task.id}</td>
                        <td className="px-4 py-2 text-neutral-900">{task.annotation_number}</td>
                        <td className="px-4 py-2 text-neutral-500 text-xs">
                          {task.assigned_user?.display_name || '—'}
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={specificAssignments[task.id] || ''}
                            onChange={(e) => handleSpecificAssignment(task.id, e.target.value)}
                            className="w-full border border-neutral-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                          >
                            <option value="">-- Select User --</option>
                            {campaignUsers.map((user) => (
                              <option key={user.user.id} value={user.user.id}>
                                {user.user.display_name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-sm font-medium text-blue-900 mb-1">Assignment Preview</h3>
            <p className="text-sm text-blue-700">
              {previewAssignmentCount} task(s) will be assigned
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-300 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={assigning}
            className="px-4 py-2 border border-neutral-300 rounded-lg hover:bg-neutral-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={assigning || previewAssignmentCount === 0}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {assigning && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            Assign Tasks
          </button>
        </div>
      </div>
    </div>
  );
};
