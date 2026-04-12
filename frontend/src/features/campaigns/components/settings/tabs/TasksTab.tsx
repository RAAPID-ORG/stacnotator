import React from 'react';
import { TaskGenerationSection } from '~/features/campaigns/components/settings/TaskGenerationSection';
import { AnnotationTasksTable } from '~/features/campaigns/components/settings/AnnotationTasksTable';
import { TaskLocationsMap } from '~/features/campaigns/components/settings/TaskLocationsMap';
import type { AnnotationTaskOut, CampaignUserOut, GenerateTasksResponse } from '~/api/client';
import { Button } from '~/shared/ui/forms';

interface Props {
  annotationTasks: AnnotationTaskOut[];
  campaignUsers: CampaignUserOut[];
  taskFile: File | null;
  setTaskFile: (f: File | null) => void;
  uploadingTasks: boolean;
  handleUploadAnnotationTasks: () => Promise<void>;
  handleTasksGenerated: (response: GenerateTasksResponse) => Promise<void>;
  onTaskGenerationError: (message: string) => void;
  onOpenBulkAssign: () => void;
  onOpenReviewerAssign: () => void;
  handleAssignSingleTask: (taskId: number, userId: string) => Promise<void>;
  handleUnassignTask: (taskId: number, userId: string) => Promise<void>;
  handleDeleteTasks: (taskIds: number[]) => Promise<void>;
  campaignId: number;
  bbox?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

export const TasksTab: React.FC<Props> = ({
  annotationTasks,
  campaignUsers,
  taskFile,
  setTaskFile,
  uploadingTasks,
  handleUploadAnnotationTasks,
  handleTasksGenerated,
  onTaskGenerationError,
  onOpenBulkAssign,
  onOpenReviewerAssign,
  handleAssignSingleTask,
  handleUnassignTask,
  handleDeleteTasks,
  campaignId,
  bbox,
}) => {
  const sectionCls =
    'space-y-4 pt-6 mt-6 first:mt-0 first:pt-0 border-t border-neutral-100 first:border-t-0';

  return (
    <div id="tab-tasks" role="tabpanel">
      {/* Task Locations Map - shown above the form sections, no card wrapper */}
      {annotationTasks.length > 0 && bbox && (
        <section className="mb-6">
          <TaskLocationsMap tasks={annotationTasks} bbox={bbox} />
        </section>
      )}

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">Add annotation tasks</h2>
          <p className="section-description">
            Tasks define the points or polygons annotators will label. Upload existing locations or
            generate them with random/grid sampling.
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
              <label
                className={`flex-1 flex items-center gap-3 h-9 px-1 pr-3 border border-neutral-300 rounded-md bg-white transition-colors ${
                  uploadingTasks
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer hover:border-neutral-400'
                }`}
              >
                <input
                  type="file"
                  accept=".csv,.geojson,.json"
                  onChange={(e) => setTaskFile(e.target.files?.[0] || new File([], ''))}
                  disabled={uploadingTasks}
                  className="sr-only"
                />
                <span className="inline-flex items-center h-7 px-3 rounded text-xs font-medium bg-neutral-100 text-neutral-700 shrink-0">
                  Choose file
                </span>
                <span className="text-xs text-neutral-500 truncate">
                  {taskFile && taskFile.size > 0 ? taskFile.name : 'No file selected'}
                </span>
              </label>
              <Button
                onClick={handleUploadAnnotationTasks}
                disabled={!taskFile || taskFile.size === 0 || uploadingTasks}
              >
                Upload
              </Button>
            </div>
          </div>
        )}

        {taskFile === null && (
          <TaskGenerationSection
            campaignId={campaignId}
            onTasksGenerated={handleTasksGenerated}
            onError={onTaskGenerationError}
          />
        )}
      </section>

      <section className={sectionCls}>
        <div>
          <h2 className="section-heading">
            Annotation tasks{' '}
            <span className="text-neutral-400 font-normal">({annotationTasks.length})</span>
          </h2>
        </div>
        {annotationTasks.length > 0 ? (
          <AnnotationTasksTable
            tasks={annotationTasks}
            campaignUsers={campaignUsers}
            onAssignTasks={handleAssignSingleTask}
            onUnassignTask={handleUnassignTask}
            onOpenBulkAssign={onOpenBulkAssign}
            onOpenReviewerAssign={onOpenReviewerAssign}
            onDeleteTasks={handleDeleteTasks}
          />
        ) : (
          <p className="text-sm text-neutral-500">
            No annotation tasks yet. Upload a file or generate tasks using sampling above.
          </p>
        )}
      </section>
    </div>
  );
};

export default TasksTab;
