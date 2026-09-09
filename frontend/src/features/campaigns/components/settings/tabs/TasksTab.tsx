import React, { useEffect, useState } from 'react';
import { TaskGenerationSection } from '~/features/campaigns/components/settings/TaskGenerationSection';
import { Modal } from '~/shared/ui/Modal';
import { TaskModeReview } from '~/features/campaigns/components/review/TaskModeReview';
import Statistics from '~/features/campaigns/components/review/Statistics';
import { countTasksByStatus } from '~/shared/utils/taskStatus';
import { TaskLocationsMap } from '~/features/campaigns/components/settings/TaskLocationsMap';
import { TaskAssignmentsExportImport } from '~/features/campaigns/components/settings/TaskAssignmentsExportImport';
import {
  TaskScopeBar,
  type TaskScope,
} from '~/features/campaigns/components/settings/TaskScopeBar';
import type {
  AnnotationTaskOut,
  CampaignSummaryOut,
  GenerateTasksResponse,
  TaskSetOut,
} from '~/api/client';
import { Button } from '~/shared/ui/forms';
import { Tooltip } from '~/shared/ui/Tooltip';
import { FileInput } from '~/shared/ui/FileInput';
import { IconChevronLeft, IconImportExport, IconPlus } from '~/shared/ui/Icons';
import { AreaEstimationSetup } from '~/features/areaEstimation/AreaEstimation';

interface Props {
  campaign: CampaignSummaryOut;
  /** Members may read the task list; changing what is in it is an admin's. */
  canManage: boolean;
  // Already filtered to the active scope by the page (single source of truth).
  scopedTasks: AnnotationTaskOut[];
  totalTasks: number;
  taskFile: File | null;
  setTaskFile: (f: File | null) => void;
  uploadingTasks: boolean;
  /** Resolves true once the file landed, so the host can close the dialog it sits in. */
  handleUploadAnnotationTasks: () => Promise<boolean>;
  handleTasksGenerated: (response: GenerateTasksResponse) => void;
  onTaskGenerationError: (message: string) => void;
  onOpenBulkAssign: () => void;
  onOpenReviewerAssign: () => void;
  onAssignSelected: (taskIds: number[]) => void;
  handleBatchUnassignTasks: (taskIds: number[]) => Promise<void>;
  handleDeleteTasks: (taskIds: number[]) => Promise<void>;
  onAssignmentsImported: () => Promise<void>;
  taskSets: TaskSetOut[];
  taskScope: TaskScope;
  onSelectScope: (scope: TaskScope) => void;
  onCreateSetScoped: (name: string) => Promise<number | null>;
  onRenameTaskSet: (id: number, name: string) => Promise<void>;
  onDeleteTaskSet: (id: number) => Promise<boolean>;
  onMoveTasks?: (taskIds: number[], taskSetId: number) => Promise<void>;
  /** Task sets owned by an area estimation design; closed to hand-added tasks. */
  areaEstimationSets?: ReadonlySet<number>;
  bbox?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

export const TasksTab: React.FC<Props> = ({
  campaign,
  canManage,
  scopedTasks,
  totalTasks,
  taskFile,
  setTaskFile,
  uploadingTasks,
  handleUploadAnnotationTasks,
  handleTasksGenerated,
  onTaskGenerationError,
  onOpenBulkAssign,
  onOpenReviewerAssign,
  onAssignSelected,
  handleBatchUnassignTasks,
  handleDeleteTasks,
  onAssignmentsImported,
  taskSets,
  taskScope,
  onSelectScope,
  onCreateSetScoped,
  onRenameTaskSet,
  onDeleteTaskSet,
  onMoveTasks,
  areaEstimationSets,
  bbox,
}) => {
  const campaignId = campaign.id;
  const sectionCls =
    'space-y-4 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  const scopedSet = taskScope === 'all' ? undefined : taskSets.find((s) => s.id === taskScope);
  const scopeIsLocked = taskScope !== 'all' && (areaEstimationSets?.has(taskScope) ?? false);

  // While a design is being written the page is the wizard and nothing else:
  // the set list and the task table would otherwise repeat under every step of
  // it, and neither can be acted on until the sample is drawn.
  const [designEditing, setDesignEditing] = useState(false);
  // Adding tasks and moving assignments around are occasional admin errands, so they
  // live behind the task list's own header rather than as sections competing with it.
  const [openDialog, setOpenDialog] = useState<'add-tasks' | 'assignments' | null>(null);
  useEffect(() => {
    setDesignEditing(false);
    setOpenDialog(null);
  }, [taskScope]);
  const writingDesign = scopeIsLocked && designEditing;

  // A sample set the design owns takes no hand-added tasks at all, so the button is
  // gone there. Across all sets it stays put but disabled: there is no one set to
  // upload into, and hiding it would just look like the control had moved.
  const canAddTasks = canManage && !scopeIsLocked;
  const noSetToAddTo = taskScope === 'all';
  const canMoveAssignments = canManage && totalTasks > 0;

  const uploadThenClose = async () => {
    if (await handleUploadAnnotationTasks()) setOpenDialog(null);
  };

  const areaEstimationSection = scopedSet && (
    <section className={sectionCls}>
      <AreaEstimationSetup
        campaignId={campaignId}
        taskSetId={scopedSet.id}
        taskSetName={scopedSet.name}
        onEditingChange={setDesignEditing}
      />
    </section>
  );

  const addTasksBody = (
    <div className="p-5 space-y-4">
      <p className="section-description">
        Tasks define the points or polygons annotators will label. Upload existing locations or
        generate them with random/grid sampling into <strong>{scopedSet?.name}</strong>.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => {
            if (taskFile === null) {
              setTaskFile(new File([], ''));
            }
          }}
          className={`text-left px-4 py-3 rounded-lg border transition-colors ${
            taskFile !== null
              ? 'bg-brand-50 text-brand-800 border-brand-400'
              : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
          }`}
          type="button"
        >
          <div className="text-sm font-medium">Upload file</div>
          <div className="text-xs text-neutral-500 mt-0.5">Upload tasks from CSV or GeoJSON</div>
        </button>
        <button
          onClick={() => setTaskFile(null)}
          className={`text-left px-4 py-3 rounded-lg border transition-colors ${
            taskFile === null
              ? 'bg-brand-50 text-brand-800 border-brand-400'
              : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
          }`}
          type="button"
        >
          <div className="text-sm font-medium">Generate via sampling</div>
          <div className="text-xs text-neutral-500 mt-0.5">
            Create tasks using random or grid sampling
          </div>
        </button>
      </div>

      {taskFile !== null && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500 leading-relaxed">
            Upload a <strong>CSV</strong> (<code>id,lon,lat</code>) for point locations, or a{' '}
            <strong>GeoJSON</strong> file with Point / Polygon features. Polygon geometries are
            preserved and shown as sample extents during annotation. For Points you may want to
            specify the sample extent (bbox size around the point) under the General Settings tab.
            The id <strong>must be unique within your whole campaign and must be numeric.</strong>
          </p>
          <div className="flex gap-3 items-center">
            <FileInput
              accept=".csv,.geojson,.json"
              disabled={uploadingTasks}
              className="flex-1"
              fileName={taskFile && taskFile.size > 0 ? taskFile.name : null}
              onSelect={setTaskFile}
            />
            <Button
              onClick={uploadThenClose}
              disabled={!taskFile || taskFile.size === 0 || uploadingTasks}
            >
              Upload
            </Button>
          </div>
        </div>
      )}

      {taskFile === null && taskScope !== 'all' && (
        <TaskGenerationSection
          campaignId={campaignId}
          taskSetId={taskScope}
          onTasksGenerated={(response) => {
            setOpenDialog(null);
            handleTasksGenerated(response);
          }}
          onError={onTaskGenerationError}
        />
      )}
    </div>
  );

  const tasksTableHeading = (
    <h2 className="section-heading">
      Annotation tasks <span className="text-neutral-400 font-normal">({scopedTasks.length})</span>
    </h2>
  );

  const addTasksButton = (
    <Button
      size="sm"
      disabled={noSetToAddTo}
      onClick={() => setOpenDialog('add-tasks')}
      leading={<IconPlus className="w-3.5 h-3.5" />}
    >
      Add tasks
    </Button>
  );

  const tasksTableActions = (canAddTasks || canMoveAssignments) && (
    <>
      {canMoveAssignments && (
        <button
          type="button"
          onClick={() => setOpenDialog('assignments')}
          className="h-8 w-8 inline-flex items-center justify-center rounded text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
          title="Export or import who these tasks are assigned to"
          aria-label="Export or import assignments"
        >
          <IconImportExport className="w-4 h-4" />
        </button>
      )}
      {canAddTasks &&
        (noSetToAddTo ? (
          <Tooltip text="Select the task set to upload or generate tasks into.">
            {addTasksButton}
          </Tooltip>
        ) : (
          addTasksButton
        ))}
    </>
  );

  const tasksTable = (
    <section className={sectionCls}>
      {scopedTasks.length > 0 ? (
        <TaskModeReview
          campaign={campaign}
          campaignId={campaignId}
          tasks={scopedTasks}
          taskSets={taskSets}
          hideSetFilter
          embedded
          headerSlot={tasksTableHeading}
          headerActions={tasksTableActions}
          selectable={canManage}
          onOpenBulkAssign={canManage ? onOpenBulkAssign : undefined}
          onOpenReviewerAssign={canManage ? onOpenReviewerAssign : undefined}
          onAssignSelected={canManage ? onAssignSelected : undefined}
          onBatchUnassignTasks={canManage ? handleBatchUnassignTasks : undefined}
          onDeleteTasks={canManage ? handleDeleteTasks : undefined}
          onMoveTasks={canManage && !scopeIsLocked ? onMoveTasks : undefined}
          lockedTaskSetIds={areaEstimationSets}
          onCreateSet={canManage ? onCreateSetScoped : undefined}
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            {tasksTableHeading}
            {tasksTableActions && (
              <div className="ml-auto flex items-center gap-2">{tasksTableActions}</div>
            )}
          </div>
          <p className="text-sm text-neutral-500">
            {scopeIsLocked
              ? 'No sampling units drawn yet. They appear here once the design above is finished.'
              : !canManage
                ? 'No annotation tasks in this set yet.'
                : taskScope === 'all'
                  ? 'No annotation tasks yet. Select a set to upload or generate tasks.'
                  : 'No tasks in this set yet. Add tasks to upload a file or generate them.'}
          </p>
        </>
      )}
    </section>
  );

  return (
    <div id="tab-tasks" role="tabpanel">
      <section className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 rounded-t-xl border-b border-neutral-100 bg-white/85 px-6 pb-4 pt-6 backdrop-blur-sm">
        {writingDesign ? (
          <button
            type="button"
            onClick={() => onSelectScope('all')}
            className="flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-800"
          >
            <IconChevronLeft className="h-4 w-4" />
            Back to task sets
          </button>
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Task set
            </p>
            <TaskScopeBar
              scope={taskScope}
              taskSets={taskSets}
              totalTasks={totalTasks}
              onSelect={onSelectScope}
              onCreateSet={canManage ? onCreateSetScoped : undefined}
              onRenameSet={canManage ? onRenameTaskSet : undefined}
              onDeleteSet={canManage ? onDeleteTaskSet : undefined}
              lockedSetIds={areaEstimationSets}
            />
          </>
        )}
      </section>

      {/* The wrapper makes `first:` strip the border of whichever section comes
          right below the scope bar, which already draws its own bottom line. */}
      <div>
        {!writingDesign && scopedTasks.length > 0 && bbox && (
          <section className={sectionCls}>
            <TaskLocationsMap
              campaignId={campaignId}
              taskSetId={taskScope === 'all' ? undefined : taskScope}
              statusCounts={countTasksByStatus(scopedTasks)}
              totalTasks={scopedTasks.length}
              bbox={bbox}
            />
          </section>
        )}

        {!writingDesign && scopedTasks.length > 0 && (
          <section className={sectionCls}>
            <Statistics
              campaignId={campaignId}
              taskSetId={taskScope === 'all' ? undefined : taskScope}
            />
          </section>
        )}

        {taskScope !== 'all' && scopeIsLocked && areaEstimationSection}

        {!writingDesign && tasksTable}
      </div>

      {openDialog === 'add-tasks' && (
        <Modal
          title={`Add annotation tasks to ${scopedSet?.name ?? 'this set'}`}
          onClose={() => setOpenDialog(null)}
          maxWidth="max-w-3xl"
        >
          {addTasksBody}
        </Modal>
      )}

      {openDialog === 'assignments' && (
        <Modal
          title="Export or import assignments"
          onClose={() => setOpenDialog(null)}
          maxWidth="max-w-xl"
        >
          <div className="p-5 space-y-3">
            <p className="section-description">
              Who each task is assigned to and who reviews it, as a CSV to edit and upload again.
              This never creates or removes tasks.
            </p>
            <TaskAssignmentsExportImport
              campaignId={campaignId}
              campaignName={campaign.name}
              taskSetId={taskScope === 'all' ? undefined : taskScope}
              onImported={onAssignmentsImported}
            />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default TasksTab;
