import React from 'react';
import { TaskGenerationSection } from '~/features/campaigns/components/settings/TaskGenerationSection';
import { TaskModeReview } from '~/features/campaigns/components/review/TaskModeReview';
import Statistics from '~/features/campaigns/components/review/Statistics';
import { TaskLocationsMap } from '~/features/campaigns/components/settings/TaskLocationsMap';
import { TaskAssignmentsExportImport } from '~/features/campaigns/components/settings/TaskAssignmentsExportImport';
import {
  TaskScopeBar,
  type TaskScope,
} from '~/features/campaigns/components/settings/TaskScopeBar';
import type {
  AnnotationTaskOut,
  CampaignOut,
  GenerateTasksResponse,
  TaskSetOut,
} from '~/api/client';
import { Button } from '~/shared/ui/forms';
import { FileInput } from '~/shared/ui/FileInput';
import {
  AreaEstimationSetup,
  createAreaEstimationPlan,
} from '~/features/areaEstimation/AreaEstimation';

interface Props {
  campaign: CampaignOut;
  /** Members may read the task list; changing what is in it is an admin's. */
  canManage: boolean;
  // Already filtered to the active scope by the page (single source of truth).
  scopedTasks: AnnotationTaskOut[];
  totalTasks: number;
  taskFile: File | null;
  setTaskFile: (f: File | null) => void;
  uploadingTasks: boolean;
  handleUploadAnnotationTasks: () => Promise<void>;
  handleTasksGenerated: (response: GenerateTasksResponse) => Promise<void>;
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
  /** Called when a design is created or removed, so the caller can refresh. */
  onAreaEstimationChanged?: () => void;
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
  onAreaEstimationChanged,
  bbox,
}) => {
  const campaignId = campaign.id;
  const sectionCls =
    'space-y-4 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  const scopedSet = taskScope === 'all' ? undefined : taskSets.find((s) => s.id === taskScope);
  const scopeIsLocked = taskScope !== 'all' && (areaEstimationSets?.has(taskScope) ?? false);

  /** A new set that is an area estimate from the moment it exists. */
  const onCreateAreaEstimationSet = async (name: string) => {
    const id = await onCreateSetScoped(name);
    if (id !== null) {
      await createAreaEstimationPlan(campaignId, id);
      onAreaEstimationChanged?.();
    }
    return id;
  };

  const areaEstimationSection = scopedSet && (
    <section className={sectionCls}>
      <AreaEstimationSetup
        campaignId={campaignId}
        taskSetId={scopedSet.id}
        taskSetName={scopedSet.name}
      />
    </section>
  );

  const addTasksSection = (
    <section className={sectionCls}>
      <div>
        <h2 className="section-heading">Add annotation tasks</h2>
        <p className="section-description">
          Tasks define the points or polygons annotators will label. Upload existing locations or
          generate them with random/grid sampling into <strong>{scopedSet?.name}</strong>.
        </p>
      </div>

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
              onClick={handleUploadAnnotationTasks}
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
          onTasksGenerated={handleTasksGenerated}
          onError={onTaskGenerationError}
        />
      )}
    </section>
  );

  const tasksTableHeading = (
    <h2 className="section-heading">
      Annotation tasks <span className="text-neutral-400 font-normal">({scopedTasks.length})</span>
    </h2>
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
          <div>{tasksTableHeading}</div>
          <p className="text-sm text-neutral-500">
            {scopeIsLocked
              ? 'No points drawn yet. They appear here once the design above is finished.'
              : !canManage
                ? 'No annotation tasks in this set yet.'
                : taskScope === 'all'
                  ? 'No annotation tasks yet. Select a set to upload or generate tasks.'
                  : 'No tasks in this set yet. Upload a file or generate tasks above.'}
          </p>
        </>
      )}
    </section>
  );

  return (
    <div id="tab-tasks" role="tabpanel">
      <section className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 rounded-t-xl border-b border-neutral-100 bg-white/85 px-6 pb-4 pt-6 backdrop-blur-sm">
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
          onCreateAreaEstimationSet={canManage ? onCreateAreaEstimationSet : undefined}
        />
      </section>

      {/* The wrapper makes `first:` strip the border of whichever section comes
          right below the scope bar, which already draws its own bottom line. */}
      <div>
        {totalTasks > 0 && bbox && (
          <section className={sectionCls}>
            <TaskLocationsMap tasks={scopedTasks} bbox={bbox} />
          </section>
        )}

        {totalTasks > 0 && (
          <section className={sectionCls}>
            <Statistics campaignId={campaignId} />
          </section>
        )}

        {taskScope !== 'all' &&
          (scopeIsLocked ? areaEstimationSection : canManage && addTasksSection)}

        {canManage && taskScope === 'all' && totalTasks > 0 && (
          <TaskAssignmentsExportImport
            campaignId={campaignId}
            campaignName={campaign.name}
            onImported={onAssignmentsImported}
          />
        )}

        {tasksTable}
      </div>
    </div>
  );
};

export default TasksTab;
