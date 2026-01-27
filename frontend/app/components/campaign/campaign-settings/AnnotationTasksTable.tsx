import { useState } from 'react';
import type { AnnotationTaskItemOut, CampaignUserOut } from '~/api/client';
import { extractLatLonFromWKT } from '~/utils/utility';

interface AnnotationTasksTableProps {
  tasks: AnnotationTaskItemOut[];
  campaignUsers?: CampaignUserOut[];
  onAssignTasks?: (taskId: number, userId: string) => Promise<void>;
  onOpenBulkAssign?: () => void;
}

export const AnnotationTasksTable = ({
  tasks,
  campaignUsers = [],
  onAssignTasks,
  onOpenBulkAssign,
}: AnnotationTasksTableProps) => {
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [assigningTaskId, setAssigningTaskId] = useState<number | null>(null);

  const handleToggleTask = (taskId: number) => {
    setSelectedTasks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedTasks.size === tasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(tasks.map((t) => t.id)));
    }
  };

  const handleAssignTask = async (taskId: number, userId: string) => {
    if (!onAssignTasks) return;
    try {
      setAssigningTaskId(taskId);
      await onAssignTasks(taskId, userId);
    } finally {
      setAssigningTaskId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done':
        return 'bg-green-100 text-green-800';
      case 'skipped':
        return 'bg-yellow-100 text-yellow-800';
      case 'pending':
      default:
        return 'bg-neutral-300 text-neutral-800';
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-900 text-sm">No annotation tasks yet.</p>
        <p className="text-neutral-700 text-xs mt-1">Upload a CSV file to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      {onOpenBulkAssign && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-neutral-600">
            {selectedTasks.size > 0 && <span>{selectedTasks.size} task(s) selected</span>}
          </div>
          <button
            onClick={onOpenBulkAssign}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
          >
            Bulk Assign Tasks
          </button>
        </div>
      )}

      <div className="overflow-x-auto border border-neutral-300 rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-300">
              {onAssignTasks && (
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedTasks.size === tasks.length && tasks.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left font-medium text-neutral-700">ID</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-700">Annotation #</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-700">Status</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-700">Coordinates</th>
              {onAssignTasks && campaignUsers.length > 0 && (
                <th className="px-4 py-3 text-left font-medium text-neutral-700">Assigned User</th>
              )}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const latLon = extractLatLonFromWKT(task.geometry.geometry);
              const isAssigning = assigningTaskId === task.id;
              return (
                <tr
                  key={task.id}
                  className={`border-b bg-white border-neutral-200 hover:bg-neutral-50 transition-colors ${
                    selectedTasks.has(task.id) ? 'bg-brand-50' : ''
                  }`}
                >
                  {onAssignTasks && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.id)}
                        onChange={() => handleToggleTask(task.id)}
                        className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-neutral-500">{task.id}</td>
                  <td className="px-4 py-3 text-neutral-900 font-medium">
                    {task.annotation_number}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium capitalize ${getStatusColor(task.status)}`}
                    >
                      {task.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-900 text-xs font-mono">
                    {latLon ? `${latLon.lat.toFixed(5)}, ${latLon.lon.toFixed(5)}` : '—'}
                  </td>
                  {onAssignTasks && campaignUsers.length > 0 && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={task.assigned_user?.id || ''}
                          onChange={(e) => handleAssignTask(task.id, e.target.value)}
                          disabled={isAssigning}
                          className="text-xs border border-neutral-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="">Unassigned</option>
                          {campaignUsers.map((user) => (
                            <option key={user.user.id} value={user.user.id}>
                              {user.user.display_name}
                            </option>
                          ))}
                        </select>
                        {isAssigning && (
                          <svg
                            className="w-4 h-4 animate-spin text-brand-600"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
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
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary Stats */}
      <div className="mt-4 pt-4 border-t border-neutral-200 flex items-center gap-6 text-sm text-neutral-600">
        <span>
          Total: <strong className="text-neutral-900">{tasks.length}</strong>
        </span>
        <span>
          Completed:{' '}
          <strong className="text-neutral-900">
            {tasks.filter((t) => t.status === 'done').length}
          </strong>
        </span>
        <span>
          Skipped:{' '}
          <strong className="text-neutral-900">
            {tasks.filter((t) => t.status === 'skipped').length}
          </strong>
        </span>
        <span>
          Pending:{' '}
          <strong className="text-neutral-900">
            {tasks.filter((t) => t.status === 'pending').length}
          </strong>
        </span>
      </div>
    </div>
  );
};
