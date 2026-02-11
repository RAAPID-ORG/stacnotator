import { useState, useEffect, useRef } from 'react';
import type { AnnotationTaskOut, CampaignUserOut } from '~/api/client';
import { extractLatLonFromWKT } from '~/shared/utils/utility';
import { 
  getTaskStatus, 
  getUserTaskStatuses, 
  getTaskStatusColor,
  formatTaskStatus
} from '~/shared/utils/taskStatus';

interface AnnotationTasksTableProps {
  tasks: AnnotationTaskOut[];
  campaignUsers?: CampaignUserOut[];
  onAssignTasks?: (taskId: number, userId: string) => Promise<void>;
  onUnassignTask?: (taskId: number, userId: string) => Promise<void>;
  onOpenBulkAssign?: () => void;
  onOpenReviewerAssign?: () => void;
  onDeleteTasks?: (taskIds: number[]) => Promise<void>;
}

export const AnnotationTasksTable = ({
  tasks,
  campaignUsers = [],
  onAssignTasks,
  onUnassignTask,
  onOpenBulkAssign,
  onOpenReviewerAssign,
  onDeleteTasks,
}: AnnotationTasksTableProps) => {
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [assigningTaskId, setAssigningTaskId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showUserSelectForTask, setShowUserSelectForTask] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserSelectForTask(null);
      }
    };

    if (showUserSelectForTask !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showUserSelectForTask]);

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

  const handleUnassignTask = async (taskId: number, userId: string) => {
    if (!onUnassignTask) return;
    try {
      setAssigningTaskId(taskId);
      await onUnassignTask(taskId, userId);
    } finally {
      setAssigningTaskId(null);
    }
  };

  const handleDeleteSelected = async () => {
    if (!onDeleteTasks || selectedTasks.size === 0) return;
    
    try {
      setIsDeleting(true);
      await onDeleteTasks(Array.from(selectedTasks));
      setSelectedTasks(new Set()); // Clear selection after successful delete
    } finally {
      setIsDeleting(false);
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
          <div className="flex items-center gap-2">
            {onDeleteTasks && (
              <button
                onClick={handleDeleteSelected}
                disabled={selectedTasks.size === 0 || isDeleting}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500"
              >
                {isDeleting ? 'Deleting...' : 'Delete Selected'}
              </button>
            )}
            <button
              onClick={onOpenBulkAssign}
              disabled={isDeleting}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors text-sm font-medium disabled:opacity-50"
            >
              Bulk Assign Tasks
            </button>
            {onOpenReviewerAssign && (
              <button
                onClick={onOpenReviewerAssign}
                disabled={isDeleting}
                className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors text-sm font-medium disabled:opacity-50"
              >
                Assign Reviewers
              </button>
            )}
          </div>
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
                  <td className="px-4 py-3 text-neutral-900 font-medium">
                    {task.annotation_number}
                  </td>
                  <td className="px-4 py-3">
                    <div className="group relative inline-block">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium capitalize cursor-help ${getTaskStatusColor(getTaskStatus(task))}`}
                      >
                        {formatTaskStatus(getTaskStatus(task))}
                      </span>
                      {/* Tooltip showing per-user status */}
                      {task.assignments && task.assignments.length > 0 && (
                        <div className="absolute z-10 invisible group-hover:visible bg-gray-900 text-white text-xs rounded py-2 px-3 bottom-full left-1/2 transform -translate-x-1/2 mb-2 whitespace-nowrap">
                          <div className="font-semibold mb-1">User Status:</div>
                          {Array.from(getUserTaskStatuses(task)).map(([userId, status]) => {
                            const user = campaignUsers.find(u => u.user.id === userId);
                            return (
                              <div key={userId} className="flex items-center gap-2">
                                <span>{user?.user.display_name || 'Unknown'}: </span>
                                <span className={status === 'completed' ? 'text-green-300' : 'text-yellow-300'}>
                                  {status}
                                </span>
                              </div>
                            );
                          })}
                          <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
                            <div className="border-4 border-transparent border-t-gray-900"></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-900 text-xs font-mono">
                    {latLon ? `${latLon.lat.toFixed(5)}, ${latLon.lon.toFixed(5)}` : '-'}
                  </td>
                  {onAssignTasks && campaignUsers.length > 0 && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 items-center">
                        {task.assignments && task.assignments.length > 0 ? (
                          task.assignments.map((assignment) => {
                            const user = campaignUsers.find(u => u.user.id === assignment.user_id);
                            const userStatus = getUserTaskStatuses(task).get(assignment.user_id);
                            return (
                              <span
                                key={assignment.user_id}
                                className={`inline-block px-2 py-1 rounded text-xs ${
                                  userStatus === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-700'
                                }`}
                                title={`${user?.user.display_name || 'Unknown'} - ${userStatus}`}
                              >
                                {user?.user.display_name || 'Unknown'}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-xs text-neutral-500">Unassigned</span>
                        )}
                        {/* Add User Button */}
                        <div className="relative" ref={showUserSelectForTask === task.id ? dropdownRef : null}>
                          <button
                            onClick={() => setShowUserSelectForTask(showUserSelectForTask === task.id ? null : task.id)}
                            disabled={isAssigning}
                            className="inline-block px-2 py-1 rounded text-xs bg-neutral-200 text-neutral-700 hover:bg-green-100 hover:text-green-700 transition-colors disabled:opacity-50 font-medium"
                            title="Add user to task"
                          >
                            +
                          </button>
                          
                          {/* User Select Dropdown */}
                          {showUserSelectForTask === task.id && (
                            <div className="absolute right-0 z-20 mt-1 bg-white border border-neutral-300 rounded-lg shadow-lg min-w-48 max-h-64 overflow-y-auto">
                              <div className="p-2">
                                <div className="text-xs font-medium text-neutral-700 mb-2 px-2">
                                  Manage users for task #{task.annotation_number}
                                </div>
                                {campaignUsers.map((user) => {
                                  const isAlreadyAssigned = task.assignments?.some(a => a.user_id === user.user.id);
                                  return (
                                    <button
                                      key={user.user.id}
                                      onClick={async () => {
                                        if (isAlreadyAssigned) {
                                          await handleUnassignTask(task.id, user.user.id);
                                        } else {
                                          await handleAssignTask(task.id, user.user.id);
                                        }
                                        setShowUserSelectForTask(null);
                                      }}
                                      disabled={isAssigning}
                                      className={`w-full text-left px-3 py-2 text-xs rounded transition-colors ${
                                        isAlreadyAssigned
                                          ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                          : 'hover:bg-brand-50 text-neutral-900'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <div className="font-medium">{user.user.display_name}</div>
                                          <div className="text-neutral-500">{user.user.email}</div>
                                        </div>
                                        {isAlreadyAssigned && (
                                          <span className="text-xs text-red-600 font-semibold">Remove</span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
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
          Complete:{' '}
          <strong className="text-neutral-900">
            {tasks.filter((t) => getTaskStatus(t) === 'complete').length}
          </strong>
        </span>
        <span>
          Partial:{' '}
          <strong className="text-neutral-900">
            {tasks.filter((t) => getTaskStatus(t) === 'partial').length}
          </strong>
        </span>
        <span>
          Conflicting:{' '}
          <strong className="text-neutral-900">
            {tasks.filter((t) => getTaskStatus(t) === 'conflicting').length}
          </strong>
        </span>
        <span>
          Pending:{' '}
          <strong className="text-neutral-900">
            {tasks.filter((t) => getTaskStatus(t) === 'pending').length}
          </strong>
        </span>
      </div>
    </div>
  );
};
