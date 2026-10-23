import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AnnotationTaskOut } from '~/api/client';
import { isLabelGroupActive } from '../../campaign/annotation';
import { toNotes } from '../../campaign/sliceComments';
import { useCampaign, useCampaignStore, useCatalog } from '../../stores/campaign';
import { useLayoutStore } from '../../stores/layout';
import { useWorkStore } from '../../stores/work';
import { activeGroupClass } from '../../components/FormFields';
import { DEFAULT_CONFIDENCE } from '../../taskActions';
import { LabelGrid } from './LabelGrid';
import { ReviewList } from './ReviewList';
import { sectionGridClass, sectionHeaderClass, taskSectionsFor } from './sectionLayout';
import { TaskSection } from './sections';
import { currentTask, useTasksStore } from '../../stores/tasks';
import { useClaims } from './useClaims';

/** Populates the work-store form from a task's existing annotation by the
 *  current user, or blanks it for a task with none yet. */
function loadTaskIntoForm(task: AnnotationTaskOut | null, currentUserId: string | null): void {
  const work = useWorkStore.getState();
  const mine = task?.annotations.find((a) => a.created_by_user_id === currentUserId) ?? null;
  work.setSelectedLabelId(mine?.label_id ?? null);
  work.setComment(mine?.comment ?? '');
  work.setConfidence(mine?.confidence ?? DEFAULT_CONFIDENCE);
  work.setFlagged(mine?.flagged_for_review ?? false);
  work.setFlagComment(mine?.flag_comment ?? '');
  work.setFormValues(mine?.form_values ?? {});
  work.setSliceNotes(toNotes(mine?.slice_comments));
  work.setActiveFieldIndex(null);
}

/** The task panel: the labels, plus every section the user has not moved into
 *  a panel of its own (Edit Layout). It also owns loading the form and
 *  claiming the task, so those keep running wherever the sections are. */
export function TaskControls() {
  const campaign = useCampaign();
  const catalog = useCatalog();
  const currentUserId = useCampaignStore((s) => s.currentUserId);
  const { visibleTasks, currentIndex, loaded, isSubmitting, knnValidationEnabled } = useTasksStore(
    useShallow((state) => ({
      visibleTasks: state.visibleTasks,
      currentIndex: state.currentIndex,
      loaded: state.loaded,
      isSubmitting: state.isSubmitting,
      knnValidationEnabled: state.knnValidationEnabled,
    }))
  );
  const replaceTask = useTasksStore((s) => s.replaceTask);
  const setKnnValidationEnabled = useTasksStore((s) => s.setKnnValidationEnabled);
  const isReviewMode = useCampaignStore((s) => s.isReviewMode);
  const separated = useLayoutStore((s) => s.currentLayout.main.taskSections);
  const task = visibleTasks[currentIndex] ?? null;

  const selectedLabelId = useWorkStore((s) => s.selectedLabelId);
  const activeFieldIndex = useWorkStore((s) => s.activeFieldIndex);
  const setSelectedLabelId = useWorkStore((s) => s.setSelectedLabelId);

  const labels = campaign.settings.labels;
  const fields = campaign.settings.form_fields ?? [];
  const labelGroupActive = isLabelGroupActive(activeFieldIndex, fields.length);
  const inPanel = taskSectionsFor(fields.length > 0).filter((section) => !separated?.[section.id]);

  useEffect(() => {
    loadTaskIntoForm(task, currentUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload the form whenever the current task identity or user changes, not on every object replacement or keystroke against it
  }, [task?.id, currentUserId]);

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

  return (
    // Narrow, everything stacks. With room for two columns the labels sit
    // beside the rest; with room for three they go full width on top and the
    // rest fill a row of equal-height cells beneath, as many across as fit.
    <div className="@container w-full h-full bg-white overflow-y-auto overflow-x-hidden">
      {isReviewMode && <ReviewList task={task} currentUserId={currentUserId} labels={labels} />}
      <div className="flex flex-col @min-[30rem]:flex-row @min-[45rem]:flex-col">
        <div
          data-task-labels
          tabIndex={-1}
          className={`flex flex-col gap-1.5 p-3 border-b border-neutral-100 ${
            inPanel.length > 0
              ? '@min-[30rem]:flex-1 @min-[30rem]:basis-0 @min-[30rem]:border-b-0 @min-[30rem]:border-r @min-[45rem]:flex-none @min-[45rem]:basis-auto @min-[45rem]:border-r-0 @min-[45rem]:border-b'
              : 'flex-1'
          } ${labelGroupActive ? activeGroupClass : ''} focus:outline-none`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={sectionHeaderClass(labelGroupActive)}>Label</span>
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none"
              title="Validate against prior labels using embedding similarity (kNN)"
            >
              <span className="relative">
                <input
                  type="checkbox"
                  checked={knnValidationEnabled}
                  onChange={(e) => setKnnValidationEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <span className="block w-6 h-3 bg-neutral-300 rounded-full peer-checked:bg-brand-600 transition-colors" />
                <span className="absolute top-0.5 left-0.5 w-2 h-2 bg-white rounded-full shadow-sm peer-checked:translate-x-3 transition-transform" />
              </span>
              <span className="text-[10px] text-neutral-600">Validate</span>
            </label>
          </div>
          <LabelGrid
            labels={labels}
            selectedId={selectedLabelId}
            onSelect={setSelectedLabelId}
            disabled={isSubmitting}
          />
        </div>

        {inPanel.length > 0 && (
          <div className={`${sectionGridClass} flex-1 basis-0 @min-[45rem]:basis-auto`}>
            {inPanel.map((section) => (
              <TaskSection key={section.id} id={section.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
