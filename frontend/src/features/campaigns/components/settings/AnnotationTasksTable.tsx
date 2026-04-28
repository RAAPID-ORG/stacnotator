import { useState, useEffect, useRef } from 'react';
import type { AnnotationTaskOut, CampaignUserOut } from '~/api/client';
import { extractCentroidFromWKT } from '~/shared/utils/utility';
import {
  getUserTaskStatuses,
  getTaskStatusColor,
  formatTaskStatus,
} from '~/shared/utils/taskStatus';
import type { TaskStatus } from '~/shared/utils/taskStatus';
import { Button } from '~/shared/ui/forms';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';

interface AnnotationTasksTableProps {
  tasks: AnnotationTaskOut[];
  campaignUsers?: CampaignUserOut[];
  onAssignTasks?: (taskId: number, userId: string) => Promise<void>;
  onUnassignTask?: (taskId: number, userId: string) => Promise<void>;
  onOpenBulkAssign?: () => void;
  onOpenReviewerAssign?: () => void;
  onBatchUnassignTasks?: (taskIds: number[]) => Promise<void>;
  onDeleteTasks?: (taskIds: number[]) => Promise<void>;
}

export const AnnotationTasksTable = ({
  tasks,
  campaignUsers = [],
  onAssignTasks,
  onUnassignTask,
  onOpenBulkAssign,
  onOpenReviewerAssign,
  onBatchUnassignTasks,
  onDeleteTasks,
}: AnnotationTasksTableProps) => {
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [assigningTaskId, setAssigningTaskId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBatchUnassigning, setIsBatchUnassigning] = useState(false);
  const [confirmBatchUnassign, setConfirmBatchUnassign] = useState(false);
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

  const selectedTasksHaveAssignments = tasks.some(
    (t) => selectedTasks.has(t.id) && t.assignments && t.assignments.length > 0
  );

  const handleBatchUnassignSelected = async () => {
    if (!onBatchUnassignTasks || selectedTasks.size === 0) return;

    try {
      setIsBatchUnassigning(true);
      await onBatchUnassignTasks(Array.from(selectedTasks));
      setSelectedTasks(new Set());
    } finally {
      setIsBatchUnassigning(false);
      setConfirmBatchUnassign(false);
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
          <div className="text-xs text-neutral-500">
            {selectedTasks.size > 0 && <span>{selectedTasks.size} selected</span>}
          </div>
          <div className="flex items-center gap-2">
            {onDeleteTasks && (
              <Button
                variant="danger"
                onClick={handleDeleteSelected}
                disabled={selectedTasks.size === 0 || isDeleting || isBatchUnassigning}
              >
                {isDeleting ? 'Deleting…' : 'Delete selected'}
              </Button>
            )}
            {onBatchUnassignTasks && (
              <Button
                variant="secondary"
                onClick={() => setConfirmBatchUnassign(true)}
                disabled={
                  selectedTasks.size === 0 ||
                  !selectedTasksHaveAssignments ||
                  isDeleting ||
                  isBatchUnassigning
                }
                title={
                  selectedTasks.size === 0
                    ? 'Select tasks to unassign'
                    : !selectedTasksHaveAssignments
                      ? 'Selected tasks have no assignments'
                      : undefined
                }
              >
                {isBatchUnassigning ? 'Unassigning…' : 'Unassign selected'}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={onOpenBulkAssign}
              disabled={isDeleting || isBatchUnassigning}
            >
              Bulk assign
            </Button>
            {onOpenReviewerAssign && (
              <Button
                variant="secondary"
                onClick={onOpenReviewerAssign}
                disabled={isDeleting || isBatchUnassigning}
              >
                Assign reviewers
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-neutral-200">
              {onAssignTasks && (
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={selectedTasks.size === tasks.length && tasks.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-brand-600 rounded focus:ring-brand-600"
                  />
                </th>
              )}
              <th className="px-3 py-2 text-left text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                Annotation #
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                Coordinates
              </th>
              {onAssignTasks && campaignUsers.length > 0 && (
                <th className="px-3 py-2 text-left text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                  Assigned
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {tasks.map((task) => {
              const latLon = extractCentroidFromWKT(task.geometry.geometry);
              const isAssigning = assigningTaskId === task.id;
              return (
                <tr
                  key={task.id}
                  className={`hover:bg-neutral-50 transition-colors ${
                    selectedTasks.has(task.id) ? 'bg-brand-50/60' : ''
                  }`}
                >
                  {onAssignTasks && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.id)}
                        onChange={() => handleToggleTask(task.id)}
                        className="w-4 h-4 text-brand-600 rounded focus:ring-brand-600"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 text-neutral-900 font-medium tabular-nums">
                    {task.annotation_number}
                  </td>
                  <td className="px-3 py-2">
                    <div className="group relative inline-block">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium capitalize cursor-help ${getTaskStatusColor(task.task_status as TaskStatus)}`}
                      >
                        {formatTaskStatus(task.task_status as TaskStatus)}
                      </span>
                      {/* Tooltip showing per-user status */}
                      {task.assignments && task.assignments.length > 0 && (
                        <div className="absolute z-10 invisible group-hover:visible bg-neutral-900 text-white text-xs rounded py-2 px-3 bottom-full left-1/2 transform -translate-x-1/2 mb-2 whitespace-nowrap">
                          <div className="font-semibold mb-1">User Status:</div>
                          {Array.from(getUserTaskStatuses(task)).map(([userId, status]) => {
                            const user = campaignUsers.find((u) => u.user.id === userId);
                            return (
                              <div key={userId} className="flex items-center gap-2">
                                <span>{user?.user.display_name || 'Unknown'}: </span>
                                <span
                                  className={
                                    status === 'completed'
                                      ? 'text-green-300'
                                      : status === 'skipped'
                                        ? 'text-violet-300'
                                        : 'text-yellow-300'
                                  }
                                >
                                  {status}
                                </span>
                              </div>
                            );
                          })}
                          <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
                            <div className="border-4 border-transparent border-t-neutral-900"></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-neutral-600 text-xs font-mono tabular-nums">
                    {latLon ? `${latLon.lat.toFixed(5)}, ${latLon.lon.toFixed(5)}` : '-'}
                  </td>
                  {onAssignTasks && campaignUsers.length > 0 && (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 items-center">
                        {task.assignments && task.assignments.length > 0 ? (
                          task.assignments.map((assignment) => {
                            const user = campaignUsers.find(
                              (u) => u.user.id === assignment.user_id
                            );
                            const userStatus = getUserTaskStatuses(task).get(assignment.user_id);
                            return (
                              <span
                                key={assignment.user_id}
                                className={`inline-block px-2 py-1 rounded text-xs ${
                                  userStatus === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : userStatus === 'skipped'
                                      ? 'bg-violet-100 text-violet-700'
                                      : 'bg-neutral-100 text-neutral-700'
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
                        <div
                          className="relative"
                          ref={showUserSelectForTask === task.id ? dropdownRef : null}
                        >
                          <button
                            onClick={() =>
                              setShowUserSelectForTask(
                                showUserSelectForTask === task.id ? null : task.id
                              )
                            }
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
                                  const isAlreadyAssigned = task.assignments?.some(
                                    (a) => a.user_id === user.user.id
                                  );
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
                                          <div className="font-medium">
                                            {user.user.display_name}
                                          </div>
                                          <div className="text-neutral-500">{user.user.email}</div>
                                        </div>
                                        {isAlreadyAssigned && (
                                          <span className="text-xs text-red-600 font-semibold">
                                            Remove
                                          </span>
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

      <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-xs text-neutral-500">
        <span>
          Total <strong className="text-neutral-900 tabular-nums">{tasks.length}</strong>
        </span>
        <span>
          Complete{' '}
          <strong className="text-neutral-900 tabular-nums">
            {tasks.filter((t) => t.task_status === 'done').length}
          </strong>
        </span>
        <span>
          Partial{' '}
          <strong className="text-neutral-900 tabular-nums">
            {tasks.filter((t) => t.task_status === 'partial').length}
          </strong>
        </span>
        <span>
          Conflicting{' '}
          <strong className="text-neutral-900 tabular-nums">
            {tasks.filter((t) => t.task_status === 'conflicting').length}
          </strong>
        </span>
        <span>
          Pending{' '}
          <strong className="text-neutral-900 tabular-nums">
            {tasks.filter((t) => t.task_status === 'pending').length}
          </strong>
        </span>
        <span>
          Skipped{' '}
          <strong className="text-neutral-900 tabular-nums">
            {tasks.filter((t) => t.task_status === 'skipped').length}
          </strong>
        </span>
      </div>

      <ConfirmDialog
        isOpen={confirmBatchUnassign}
        title="Unassign selected tasks?"
        description={`This will remove all user assignments from ${selectedTasks.size} selected task(s). Annotations already submitted are preserved. This action cannot be undone.`}
        confirmText="Unassign"
        cancelText="Cancel"
        isDangerous
        isLoading={isBatchUnassigning}
        onConfirm={handleBatchUnassignSelected}
        onCancel={() => setConfirmBatchUnassign(false)}
      />
    </div>
  );
};
