import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { IconChevronLeft, IconChevronRight } from '~/shared/ui/Icons';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useCampaign, useCampaignStore, useCatalog } from '../../stores/campaign';
import { currentTask, useTasksStore } from '../../stores/tasks';
import { advance } from '../../taskActions';
import { ClassifyTaskWork } from './ClassifyTaskWork';
import { DrawTaskWork } from './DrawTaskWork';
import { ReviewList } from './ReviewList';
import { useClaims } from './useClaims';

const navButtonClass =
  'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-neutral-600 border border-neutral-200 rounded hover:bg-neutral-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer';

/** The task panel: who holds the task, the work that answers it - a label or
 *  drawn shapes, per the campaign's task output - and moving between tasks. */
export function TaskControls() {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const currentUserId = useCampaignStore((s) => s.currentUserId);
  const {
    visibleTasks,
    currentIndex,
    loaded,
    isSubmitting,
    goToAnnotationNumber,
    previous,
    replaceTask,
  } = useTasksStore(
    useShallow((state) => ({
      visibleTasks: state.visibleTasks,
      currentIndex: state.currentIndex,
      loaded: state.loaded,
      isSubmitting: state.isSubmitting,
      goToAnnotationNumber: state.goToAnnotationNumber,
      previous: state.previous,
      replaceTask: state.replaceTask,
    }))
  );
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const [gotoValue, setGotoValue] = useState('');
  const task = visibleTasks[currentIndex] ?? null;

  const drawTask = campaign.settings.task_output === 'draw';

  useEffect(() => {
    setGotoValue(task ? String(task.annotation_number) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the current task's identity, not every object replacement of it
  }, [task?.id]);

  useClaims({
    campaignId: campaign.id,
    taskId: task?.id ?? null,
    currentUserId,
    isReviewMode,
    getTask: currentTask,
    // Including the case where somebody else holds it: the badge says so and
    // the user decides, rather than the page moving them off it.
    onClaimed: (claimed) => replaceTask(claimed, catalog),
  });

  if (!loaded) {
    return <div className="p-3 text-xs text-neutral-500">Loading tasks…</div>;
  }
  if (!task) {
    return <div className="p-3 text-xs text-neutral-500">No tasks match the current filter.</div>;
  }

  const goToTyped = () => {
    const num = parseInt(gotoValue, 10);
    if (Number.isNaN(num) || num < 1) return;
    if (!goToAnnotationNumber(num, catalog)) {
      showAlert(`Point #${num} is not in the current filter`, 'error');
    }
  };
  const showGoButton = gotoValue !== String(task.annotation_number);

  return (
    <div className="w-full h-full bg-white overflow-y-auto">
      <div className="flex flex-wrap">
        {isReviewMode && (
          <ReviewList task={task} currentUserId={currentUserId} labels={campaign.settings.labels} />
        )}

        {drawTask ? <DrawTaskWork task={task} /> : <ClassifyTaskWork task={task} />}

        <div className="flex flex-col gap-2 p-3 border-b border-neutral-100 flex-1 min-w-[10rem]">
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Point
            </label>
            <input
              type="number"
              value={gotoValue}
              onChange={(e) => setGotoValue(e.target.value)}
              min="1"
              max={visibleTasks.length}
              disabled={isSubmitting}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                e.stopPropagation();
                goToTyped();
                e.currentTarget.blur();
              }}
              className="w-14 px-2 py-1 text-center text-xs text-neutral-900 bg-white border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-400 disabled:opacity-50 tabular-nums"
              title="Press Enter to go"
            />
            {showGoButton && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={goToTyped}
                title="Go to annotation"
                className="px-2 py-1 text-xs font-medium text-neutral-600 border border-neutral-200 rounded hover:bg-neutral-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Go
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => previous(catalog)}
              className={navButtonClass}
            >
              <IconChevronLeft className="w-3 h-3" />
              Prev
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void advance()}
              className={navButtonClass}
            >
              Next
              <IconChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
