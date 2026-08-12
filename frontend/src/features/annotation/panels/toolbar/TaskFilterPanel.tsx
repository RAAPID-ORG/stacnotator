import type { AnnotationTaskOut, TaskSetOut } from '~/api/client';
import type { TaskStatus } from '~/features/annotation/core/apiTypes';
import { computeTaskProgress, UNASSIGNED, type TaskFilter } from '~/features/annotation/core/tasks';
import { useSessionStore } from '~/features/annotation/stores';

export interface TaskFilterPanelProps {
  tasks: AnnotationTaskOut[];
  taskSets: TaskSetOut[];
  taskFilter: TaskFilter;
  onTaskFilterChange: (patch: Partial<TaskFilter>) => void;
  currentUserId: string | null;
  isReviewMode: boolean;
}

interface UserEntry {
  id: string;
  displayName: string;
}

const TASK_STATUSES: Array<{ value: TaskStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'partial', label: 'Partial' },
  { value: 'done', label: 'Done' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'conflicting', label: 'Conflicting' },
];
const TASK_MODE_STATUSES = new Set<TaskStatus>(['pending', 'done', 'skipped']);

const checkboxRow =
  'flex items-center gap-2 px-2 py-1 text-sm hover:bg-neutral-50 rounded cursor-pointer';

export function TaskFilterPanel({
  tasks,
  taskSets,
  taskFilter,
  onTaskFilterChange,
  currentUserId,
  isReviewMode,
}: TaskFilterPanelProps) {
  const userMap = new Map<string, UserEntry>();
  for (const task of tasks) {
    for (const assignment of task.assignments || []) {
      if (!userMap.has(assignment.user_id)) {
        userMap.set(assignment.user_id, {
          id: assignment.user_id,
          displayName: assignment.user_display_name || assignment.user_email || assignment.user_id,
        });
      }
    }
  }
  const allUsers = [...userMap.values()];
  const hasUnassignedTasks = tasks.some((t) => (t.assignments || []).length === 0);
  const selectableIds = [...(hasUnassignedTasks ? [UNASSIGNED] : []), ...allUsers.map((u) => u.id)];

  const toggleAssignee = (id: string) => {
    const current = taskFilter.assignedTo.length === 0 ? selectableIds : taskFilter.assignedTo;
    const next = current.includes(id)
      ? current.filter((existing) => existing !== id)
      : [...current, id];
    onTaskFilterChange({ assignedTo: next });
  };

  const toggleStatus = (status: TaskStatus) => {
    const isSelected = taskFilter.statuses.includes(status);
    const next = isSelected
      ? taskFilter.statuses.filter((s) => s !== status)
      : [...taskFilter.statuses, status];
    if (next.length === 0) return;

    // Selecting 'conflicting' also opens review mode and widens to every
    // assignee - conflicting tasks
    // only make sense to look at across every annotator.
    if (!isSelected && status === 'conflicting') {
      useSessionStore.getState().setReviewMode(true);
      onTaskFilterChange({ statuses: next, assignedTo: [] });
      return;
    }
    onTaskFilterChange({ statuses: next });
  };

  const isShowingAll = taskFilter.assignedTo.length === 0;
  const isShowingMineOnly =
    taskFilter.assignedTo.length === 1 && taskFilter.assignedTo[0] === currentUserId;

  const statusOptions = isReviewMode
    ? TASK_STATUSES
    : TASK_STATUSES.filter((s) => TASK_MODE_STATUSES.has(s.value));

  return (
    <div
      className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[280px] p-3"
      data-testid="task-filter-panel"
    >
      <div className="space-y-3">
        <div>
          <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
            Assigned To
          </div>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => onTaskFilterChange({ assignedTo: [] })}
              className={`px-2 py-1 text-xs rounded ${isShowingAll ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
            >
              All
            </button>
            {currentUserId && (
              <button
                type="button"
                onClick={() => onTaskFilterChange({ assignedTo: [currentUserId] })}
                className={`px-2 py-1 text-xs rounded ${isShowingMineOnly ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
              >
                Mine
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {hasUnassignedTasks && (
              <label className={checkboxRow}>
                <input
                  type="checkbox"
                  checked={
                    taskFilter.assignedTo.length === 0 || taskFilter.assignedTo.includes(UNASSIGNED)
                  }
                  onChange={() => toggleAssignee(UNASSIGNED)}
                  aria-label="Unassigned"
                  className="rounded accent-brand-500"
                />
                <span className="text-neutral-500 italic">Unassigned</span>
              </label>
            )}
            {allUsers.map((user) => (
              <label key={user.id} className={checkboxRow}>
                <input
                  type="checkbox"
                  checked={
                    taskFilter.assignedTo.length === 0 || taskFilter.assignedTo.includes(user.id)
                  }
                  onChange={() => toggleAssignee(user.id)}
                  aria-label={user.displayName}
                  className="rounded accent-brand-500"
                />
                <span className="text-neutral-900">{user.displayName}</span>
              </label>
            ))}
            {allUsers.length === 0 && !hasUnassignedTasks && (
              <div className="text-xs text-neutral-500 px-2 py-1">No assigned users</div>
            )}
          </div>
        </div>

        <div className="border-t border-neutral-200 pt-3">
          <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
            Status
          </div>
          <div className="space-y-1">
            {statusOptions.map(({ value, label }) => (
              <label key={value} className={checkboxRow}>
                <input
                  type="checkbox"
                  checked={taskFilter.statuses.includes(value)}
                  onChange={() => toggleStatus(value)}
                  aria-label={label}
                  className="rounded accent-brand-500"
                />
                <span className="text-neutral-900">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {taskSets.length > 1 && (
          <div className="border-t border-neutral-200 pt-3" data-testid="task-set-picker">
            <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
              Task set
            </div>
            <div className="space-y-1">
              <label className={checkboxRow}>
                <input
                  type="radio"
                  checked={taskFilter.taskSetId === null}
                  onChange={() => onTaskFilterChange({ taskSetId: null })}
                  className="accent-brand-500"
                />
                <span className="text-neutral-900">All sets</span>
              </label>
              {taskSets.map((set) => {
                const { total, completed } = computeTaskProgress(
                  tasks.filter((t) => t.task_set_id === set.id),
                  []
                );
                return (
                  <label key={set.id} className={checkboxRow}>
                    <input
                      type="radio"
                      checked={taskFilter.taskSetId === set.id}
                      onChange={() => onTaskFilterChange({ taskSetId: set.id })}
                      className="accent-brand-500"
                    />
                    <span className="flex-1 truncate text-neutral-900">{set.name}</span>
                    <span className="text-xs text-neutral-400 tabular-nums">
                      {completed}/{total}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {isReviewMode && (
          <div className="border-t border-neutral-200 pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
                Review filters
              </div>
              {(taskFilter.selectedConfidences.length > 0 || taskFilter.flaggedOnly) && (
                <button
                  type="button"
                  onClick={() =>
                    onTaskFilterChange({ selectedConfidences: [], flaggedOnly: false })
                  }
                  className="text-[10px] text-neutral-500 hover:text-neutral-700"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="mb-2">
              <div className="text-[10px] font-medium text-neutral-500 mb-1">Confidence</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => onTaskFilterChange({ selectedConfidences: [] })}
                  className={`px-2 py-0.5 text-[11px] rounded ${taskFilter.selectedConfidences.length === 0 ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  Any
                </button>
                {[1, 2, 3, 4, 5].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      const next = taskFilter.selectedConfidences.includes(c)
                        ? taskFilter.selectedConfidences.filter((existing) => existing !== c)
                        : [...taskFilter.selectedConfidences, c];
                      onTaskFilterChange({ selectedConfidences: next });
                    }}
                    className={`w-7 py-0.5 text-[11px] rounded tabular-nums ${taskFilter.selectedConfidences.includes(c) ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                  >
                    {c}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const next = taskFilter.selectedConfidences.includes(0)
                      ? taskFilter.selectedConfidences.filter((existing) => existing !== 0)
                      : [...taskFilter.selectedConfidences, 0];
                    onTaskFilterChange({ selectedConfidences: next });
                  }}
                  title="Tasks whose annotations have no confidence rating, or no annotations"
                  className={`px-2 py-0.5 text-[11px] rounded ${taskFilter.selectedConfidences.includes(0) ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  None
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onTaskFilterChange({ flaggedOnly: !taskFilter.flaggedOnly })}
              aria-pressed={taskFilter.flaggedOnly}
              title="Show only tasks with at least one flagged annotation"
              className={`flex items-center gap-1.5 px-2 py-1 text-[11px] rounded border w-full ${taskFilter.flaggedOnly ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-neutral-100 text-neutral-700 border-transparent hover:bg-neutral-200'}`}
            >
              <span>Flagged only</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
