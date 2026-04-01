import React from 'react';
import { TaskGenerationSection } from '~/features/campaigns/components/settings/TaskGenerationSection';
import { AnnotationTasksTable } from '~/features/campaigns/components/settings/AnnotationTasksTable';
import { TaskLocationsMap } from '~/features/campaigns/components/settings/TaskLocationsMap';
import type { AnnotationTaskOut, CampaignUserOut, GenerateTasksResponse } from '~/api/client';

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
  return (
    <div id="tab-tasks" role="tabpanel" className="space-y-3">
      {/* Task Locations Map */}
      {annotationTasks.length > 0 && bbox && (
        <TaskLocationsMap tasks={annotationTasks} bbox={bbox} />
      )}

      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">Add Annotation Tasks</h2>

        <div className="mb-6">
          <label className="block text-sm font-medium text-neutral-700 mb-3">
            How would you like to create tasks?
          </label>
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (taskFile === null) {
                  setTaskFile(new File([], ''));
                }
              }}
              className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
                taskFile !== null
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              <div className="font-medium">Upload File</div>
              <div className="text-xs mt-1 opacity-90">Upload tasks from CSV or GeoJSON</div>
            </button>
            <button
              onClick={() => setTaskFile(null)}
              className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
                taskFile === null
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              <div className="font-medium">Generate via Sampling</div>
              <div className="text-xs mt-1 opacity-90">
                Create tasks using random or grid sampling
              </div>
            </button>
          </div>
        </div>

        {taskFile !== null && (
          <div>
            <h3 className="text-md font-semibold text-neutral-900 mb-3">Upload Task Locations</h3>
            <p className="text-sm text-neutral-500 mb-4">
              Upload a <strong>CSV</strong> (<code>id,lon,lat</code>) for point locations, or a{' '}
              <strong>GeoJSON</strong> file with Point / Polygon features. Polygon geometries are
              preserved and shown as sample extents during annotation.
            </p>
            <div className="flex gap-4 items-center">
              <input
                type="file"
                accept=".csv,.geojson,.json"
                onChange={(e) => setTaskFile(e.target.files?.[0] || new File([], ''))}
                disabled={uploadingTasks}
                className="flex-1 px-3 py-2 border border-neutral-300 rounded disabled:bg-neutral-50 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleUploadAnnotationTasks}
                disabled={!taskFile || taskFile.size === 0 || uploadingTasks}
                className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                Upload
              </button>
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
      </div>

      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">Annotation Tasks Overview</h2>
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
      </div>
    </div>
  );
};

export default TasksTab;
