import type { AnnotationTaskOut } from '~/api/client';
import { outcomeLabel } from '~/shared/utils/taskStatus';
import { useCampaignStore } from '../../stores/campaign';
import { useTasksStore } from '../../stores/tasks';
import { finishDrawTask, skipCurrent, taskLabellingPolicy } from '../../taskActions';
import { ExploreControls } from '../ExploreControls/ExploreControls';

const secondaryButtonClass =
  'inline-flex items-center justify-center h-8 px-3 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 shadow-sm hover:bg-neutral-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * A draw task is answered with shapes: the actions that finish the task sit
 * above the drawing tools, and every shape drawn here is saved against
 * it. Done records that this user's shapes are complete, Nothing here that
 * there was nothing to draw.
 */
export function DrawTaskWork({ task }: { task: AnnotationTaskOut }) {
  const currentUserId = useCampaignStore((s) => s.currentUserId);
  const isSubmitting = useTasksStore((s) => s.isSubmitting);
  const { mayLabel } = taskLabellingPolicy(task);
  const mine = task.annotations.find((a) => a.created_by_user_id === currentUserId);
  const answered = outcomeLabel(mine?.outcome);
  const disabled = isSubmitting || !mayLabel;

  return (
    <>
      <div
        data-testid="draw-task-finish"
        className="flex flex-col gap-2 p-3 border-r border-b border-neutral-100 flex-1 min-w-[10rem]"
      >
        <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          Finish task
        </span>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Draw everything this task asks for, then press Done.
        </p>
        {answered && (
          <p className="text-[11px] text-neutral-700" data-testid="draw-task-answer">
            Your answer: <span className="font-medium">{answered}</span>
          </p>
        )}
        {!mayLabel && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            You are not allowed to work on this task in this campaign.
          </p>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => void finishDrawTask('drawn')}
          className="inline-flex items-center justify-center h-8 px-3 text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 rounded-md shadow-sm transition-colors disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Submitting…' : 'Done'}
        </button>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void finishDrawTask('none_found')}
            className={`flex-1 ${secondaryButtonClass}`}
          >
            Nothing here
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void skipCurrent()}
            className={secondaryButtonClass}
          >
            Skip
          </button>
        </div>
      </div>

      <div className="flex-[2] min-w-[12rem] border-r border-b border-neutral-100">
        <ExploreControls />
      </div>
    </>
  );
}
