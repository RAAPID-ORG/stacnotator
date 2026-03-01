/**
 * TaskNavigator – compact navigation bar for stepping through annotation tasks.
 *
 * Shows current task index, total count, task id, and prev/next buttons.
 */

import { useTaskStore, selectCurrentTask } from './task.store';

export function TaskNavigator() {
  const tasks = useTaskStore((s) => s.tasks);
  const currentIndex = useTaskStore((s) => s.currentIndex);
  const isLoading = useTaskStore((s) => s.isLoading);
  const next = useTaskStore((s) => s.next);
  const prev = useTaskStore((s) => s.prev);
  const currentTask = useTaskStore(selectCurrentTask);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded shadow text-xs text-neutral-500">
        Loading tasks…
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded shadow text-xs text-neutral-400">
        No tasks
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-white rounded shadow px-2 py-1 text-xs text-neutral-800 select-none">
      <button
        onClick={prev}
        className="p-1 rounded hover:bg-neutral-100 transition-colors cursor-pointer disabled:opacity-40"
        disabled={tasks.length <= 1}
        title="Previous task"
        aria-label="Previous task"
      >
        ‹
      </button>

      <span className="px-1 font-medium tabular-nums">
        {currentIndex + 1} / {tasks.length}
      </span>

      {currentTask && (
        <span className="text-neutral-400 pl-1">
          #{currentTask.annotation_number}
        </span>
      )}

      <button
        onClick={next}
        className="p-1 rounded hover:bg-neutral-100 transition-colors cursor-pointer disabled:opacity-40"
        disabled={tasks.length <= 1}
        title="Next task"
        aria-label="Next task"
      >
        ›
      </button>
    </div>
  );
}
