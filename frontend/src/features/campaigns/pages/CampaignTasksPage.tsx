import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExportDropdown } from '~/features/campaigns/components/review/ExportDropdown';
import { Button } from '~/shared/ui/forms';
import type { TaskScope } from '~/features/campaigns/components/settings/TaskScopeBar';
import {
  TaskAssignmentModal,
  type BulkAssignIntent,
} from '~/features/campaigns/components/settings/TaskAssignmentModal';
import { AssignSelectedModal } from '~/features/campaigns/components/settings/AssignSelectedModal';
import {
  ReviewerAssignmentModal,
  type AssignmentPattern,
} from '~/features/campaigns/components/settings/ReviewerAssignmentModal';
import { Skeleton, SkeletonForm } from '~/shared/ui/Skeleton';
import { Delayed } from '~/shared/ui/Delayed';
import { LoadingOverlay } from '~/shared/ui/LoadingOverlay';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { campaignPath } from '~/app/routes';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';
import TasksTab from '~/features/campaigns/components/settings/tabs/TasksTab';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { FadeIn } from '~/shared/ui/motion';
import { useAreaEstimationTaskSets } from '~/features/areaEstimation/AreaEstimation';

import { type GenerateTasksResponse, type ProjectUserOut } from '~/api/client';
import {
  assignReviewersMutation,
  assignTasksToUsersMutation,
  batchUnassignTasksMutation,
  createTaskSetMutation,
  deleteAnnotationTasksMutation,
  deleteTaskSetMutation,
  getProjectUsersOptions,
  ingestAnnotationTasksFromCsvMutation,
  ingestAnnotationTasksFromGeojsonMutation,
  moveTasksToSetMutation,
  renameTaskSetMutation,
} from '~/api/queries';
import { reportedByCaller } from '~/api/queryClient';
import {
  useCampaignSummary,
  useCampaignTasks,
  useCampaignTaskSets,
  useRefreshCampaignTasks,
  useRefreshCampaignTaskSets,
  useRefreshCampaignWork,
} from '../hooks/campaignQueries';

const NO_USERS: ProjectUserOut[] = [];

export const CampaignTasksPage = () => {
  const campaignId = useCampaignIdParam();
  const { taskSetIds: areaEstimationSets } = useAreaEstimationTaskSets(campaignId);
  const routeProjectId = useProjectIdParam();
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();

  const [taskFile, setTaskFile] = useState<File | null>(new File([], ''));
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [showReviewerModal, setShowReviewerModal] = useState(false);
  const [assignSelectedTaskIds, setAssignSelectedTaskIds] = useState<number[]>([]);

  const showAlert = useLayoutStore((state) => state.showAlert);
  const path = { campaign_id: campaignId };

  const { campaign, loading } = useCampaignSummary(campaignId);

  // Campaign wins over the URL param, which only stands in until it loads and
  // can be wrong outright on a hand-edited /projects/<id>/campaigns/... URL.
  const projectId = campaign?.project_id ?? routeProjectId;

  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name, 'Tasks');

  const { tasks: annotationTasks } = useCampaignTasks(campaignId);
  const { taskSets } = useCampaignTaskSets(campaignId);

  // Assignable users are the owning project's members, so this waits for the
  // campaign to say which project to ask about.
  const { data: projectUsersData } = useQuery({
    ...getProjectUsersOptions({ path: { project_id: campaign?.project_id ?? 0 } }),
    enabled: campaign !== undefined,
    meta: { errorMessage: 'Failed to load project members' },
  });
  const projectUsers = projectUsersData?.users ?? NO_USERS;

  const reloadAnnotationTasks = useRefreshCampaignTasks(campaignId);
  const reloadTaskSets = useRefreshCampaignTaskSets(campaignId);
  const reloadTasksAndSets = useRefreshCampaignWork(campaignId);

  const uploadGeojson = useMutation({
    ...ingestAnnotationTasksFromGeojsonMutation(),
    meta: { errorMessage: 'Failed to upload annotation tasks' },
  });
  const uploadCsv = useMutation({
    ...ingestAnnotationTasksFromCsvMutation(),
    meta: { errorMessage: 'Failed to upload annotation tasks' },
  });
  const createSet = useMutation({
    ...createTaskSetMutation(),
    meta: { errorMessage: 'Failed to create task set' },
    onSuccess: reloadTaskSets,
  });
  const renameSet = useMutation({
    ...renameTaskSetMutation(),
    meta: { errorMessage: 'Failed to rename task set' },
    onSuccess: reloadTaskSets,
  });
  const deleteSet = useMutation({
    ...deleteTaskSetMutation(),
    meta: { errorMessage: 'Failed to delete task set' },
    onSuccess: reloadTasksAndSets,
  });
  const moveTasks = useMutation({
    ...moveTasksToSetMutation(),
    meta: { errorMessage: 'Failed to move tasks' },
    onSuccess: reloadTasksAndSets,
  });
  const assignTasks = useMutation({
    ...assignTasksToUsersMutation(),
    meta: reportedByCaller('Failed to assign tasks'),
    onSuccess: reloadTasksAndSets,
  });
  const assignReviewersTo = useMutation({
    ...assignReviewersMutation(),
    meta: reportedByCaller('Failed to assign reviewers'),
    onSuccess: reloadAnnotationTasks,
  });
  const unassignTasks = useMutation({
    ...batchUnassignTasksMutation(),
    meta: reportedByCaller('Failed to unassign tasks'),
    onSuccess: reloadAnnotationTasks,
  });
  const deleteTasks = useMutation({
    ...deleteAnnotationTasksMutation(),
    meta: reportedByCaller('Failed to delete tasks'),
    onSuccess: reloadTasksAndSets,
  });

  const uploadingTasks = uploadGeojson.isPending || uploadCsv.isPending;
  const saving =
    assignTasks.isPending ||
    assignReviewersTo.isPending ||
    unassignTasks.isPending ||
    deleteTasks.isPending;

  // Without a URL param the scope starts on the campaign's first (default) set;
  // "All tasks" is an explicit choice carried as taskSet=all.
  const taskSetParam = searchParams.get('taskSet');
  const requestedSetId = taskSetParam !== null ? Number(taskSetParam) : null;
  const taskScope: TaskScope =
    requestedSetId !== null && taskSets.some((s) => s.id === requestedSetId)
      ? requestedSetId
      : taskSetParam === 'all' || taskSets.length === 0
        ? 'all'
        : taskSets[0].id;

  const handleSelectScope = (scope: TaskScope) => {
    setSearchParams(
      (params) => {
        params.set('taskSet', String(scope));
        return params;
      },
      { replace: true }
    );
  };

  const isAdmin = campaign?.viewer_is_admin ?? false;

  const scopedAnnotationTasks = useMemo(
    () =>
      taskScope === 'all'
        ? annotationTasks
        : annotationTasks.filter((t) => t.task_set_id === taskScope),
    [annotationTasks, taskScope]
  );

  // The scope's request-body fragment for server-side pool selection.
  const taskScopeBody = taskScope !== 'all' ? { task_set_id: taskScope } : {};

  // Stable identity so TaskLocationsMap's memo is effective across page renders.
  const taskMapBbox = useMemo(
    () =>
      campaign
        ? {
            west: campaign.settings.bbox_west,
            south: campaign.settings.bbox_south,
            east: campaign.settings.bbox_east,
            north: campaign.settings.bbox_north,
          }
        : undefined,
    [campaign]
  );

  const handleUploadAnnotationTasks = () => {
    if (!taskFile || taskScope === 'all') return;
    const body = { file: taskFile, task_set_id: taskScope } as never;
    const name = taskFile.name.toLowerCase();
    const upload = name.endsWith('.geojson') || name.endsWith('.json') ? uploadGeojson : uploadCsv;
    upload.mutate(
      { path, body },
      {
        onSuccess: () => {
          setTaskFile(null);
          showAlert('Annotation task(s) uploaded successfully', 'success');
          reloadTasksAndSets();
        },
      }
    );
  };

  const handleCreateTaskSet = async (name: string): Promise<number | null> => {
    try {
      const created = await createSet.mutateAsync({ path, body: { name } });
      return created.id;
    } catch {
      return null;
    }
  };

  const handleRenameTaskSet = async (id: number, name: string) => {
    await renameSet.mutateAsync({ path: { ...path, task_set_id: id }, body: { name } });
  };

  const handleDeleteTaskSet = async (id: number): Promise<boolean> => {
    try {
      await deleteSet.mutateAsync({ path: { ...path, task_set_id: id } });
      return true;
    } catch {
      return false;
    }
  };

  const handleMoveTasks = async (taskIds: number[], taskSetId: number) => {
    await moveTasks.mutateAsync(
      { path: { ...path, task_set_id: taskSetId }, body: { task_ids: taskIds } },
      { onSuccess: () => showAlert(`Moved ${taskIds.length} task(s)`, 'success') }
    );
  };

  const handleTasksGenerated = (response: GenerateTasksResponse) => {
    showAlert(`${response.num_tasks_created} tasks generated successfully`, 'success');
    reloadTasksAndSets();
  };

  const handleBulkAssignTasks = async (intent: BulkAssignIntent) => {
    const result = await assignTasks.mutateAsync({
      path,
      body: {
        ...(intent.strategy === 'even'
          ? { strategy: 'even' as const, user_ids: intent.userIds }
          : { strategy: 'fixed_per_user' as const, user_task_counts: intent.userTaskCounts }),
        ...taskScopeBody,
      },
    });
    showAlert(`${result.total_assigned} task(s) assigned successfully`, 'success');
    setShowAssignmentModal(false);
  };

  const handleAssignSelected = async (mapping: Record<number, string[]>) => {
    const result = await assignTasks.mutateAsync({
      path,
      body: { strategy: 'explicit', task_assignments: Object.fromEntries(Object.entries(mapping)) },
    });
    showAlert(`${result.total_assigned} task(s) assigned`, 'success');
    setAssignSelectedTaskIds([]);
  };

  const handleAssignReviewers = async (pattern: AssignmentPattern) => {
    const body =
      pattern.type === 'percentage'
        ? {
            pattern: 'percentage' as const,
            percentage: pattern.percentage,
            num_reviewers: pattern.reviewersPerTask,
            reviewer_ids: pattern.reviewerIds,
            ...taskScopeBody,
          }
        : {
            pattern: 'fixed' as const,
            num_tasks: pattern.numTasks,
            fixed_num_reviewers: pattern.reviewersPerTask,
            reviewer_ids: pattern.reviewerIds,
            ...taskScopeBody,
          };

    await assignReviewersTo.mutateAsync({ path, body });
    showAlert(
      pattern.type === 'percentage'
        ? `Assigned ${pattern.reviewersPerTask} reviewers to ${pattern.percentage}% of tasks`
        : `Assigned ${pattern.reviewersPerTask} reviewers to ${pattern.numTasks} tasks`,
      'success'
    );
    setShowReviewerModal(false);
  };

  const handleBatchUnassignTasks = async (taskIds: number[]) => {
    if (taskIds.length === 0) {
      showAlert('No tasks selected', 'error');
      return;
    }
    await unassignTasks.mutateAsync({ path, body: { task_ids: taskIds } });
    showAlert(`Unassigned all users from ${taskIds.length} task(s)`, 'success');
  };

  const handleDeleteTasks = async (taskIds: number[]) => {
    if (taskIds.length === 0) {
      showAlert('No tasks selected', 'error');
      return;
    }
    await deleteTasks.mutateAsync({ path, body: { task_ids: taskIds } });
    showAlert(`${taskIds.length} task(s) deleted successfully`, 'success');
  };

  if (!loading && !campaign) return null;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              {campaign ? (
                <h1 className="page-title">{capitalizeFirst(campaign.name)} tasks</h1>
              ) : (
                <Skeleton className="h-7 w-52" />
              )}
              <p className="page-subtitle">
                {isAdmin
                  ? 'Upload or generate annotation tasks and manage assignments.'
                  : 'The tasks in this campaign and how far they have got.'}
              </p>
            </div>
            {campaign && (
              <div className="flex items-center gap-3">
                <ExportDropdown
                  campaignId={campaignId}
                  campaign={campaign}
                  disabled={annotationTasks.length === 0}
                  hasConflicts={annotationTasks.some((t) => t.task_status === 'conflicting')}
                />
                <Button onClick={() => navigate(campaignPath(projectId, campaignId, 'annotate'))}>
                  Start annotating
                </Button>
              </div>
            )}
          </header>

          {campaign ? (
            <>
              <div className="surface surface-unclipped">
                <div className="p-6">
                  <TasksTab
                    campaign={campaign}
                    canManage={isAdmin}
                    scopedTasks={scopedAnnotationTasks}
                    totalTasks={annotationTasks.length}
                    taskFile={taskFile}
                    setTaskFile={setTaskFile}
                    uploadingTasks={uploadingTasks}
                    handleUploadAnnotationTasks={handleUploadAnnotationTasks}
                    handleTasksGenerated={handleTasksGenerated}
                    onTaskGenerationError={(msg) => showAlert(msg, 'error')}
                    onOpenBulkAssign={() => setShowAssignmentModal(true)}
                    onOpenReviewerAssign={() => setShowReviewerModal(true)}
                    onAssignSelected={setAssignSelectedTaskIds}
                    handleBatchUnassignTasks={handleBatchUnassignTasks}
                    handleDeleteTasks={handleDeleteTasks}
                    onAssignmentsImported={reloadAnnotationTasks}
                    taskSets={taskSets}
                    areaEstimationSets={areaEstimationSets}
                    taskScope={taskScope}
                    onSelectScope={handleSelectScope}
                    onCreateSetScoped={handleCreateTaskSet}
                    onRenameTaskSet={handleRenameTaskSet}
                    onDeleteTaskSet={handleDeleteTaskSet}
                    onMoveTasks={handleMoveTasks}
                    bbox={taskMapBbox}
                  />
                </div>
              </div>
            </>
          ) : (
            <Delayed>
              <SkeletonForm sections={3} />
            </Delayed>
          )}
        </FadeIn>
      </div>

      {/* Global Modals */}
      <LoadingOverlay visible={saving} text="Saving..." />

      <TaskAssignmentModal
        isOpen={showAssignmentModal}
        onClose={() => setShowAssignmentModal(false)}
        tasks={scopedAnnotationTasks}
        projectUsers={projectUsers}
        onAssign={handleBulkAssignTasks}
      />

      <AssignSelectedModal
        isOpen={assignSelectedTaskIds.length > 0}
        numTasks={assignSelectedTaskIds.length}
        projectUsers={projectUsers}
        taskIds={assignSelectedTaskIds}
        onAssign={handleAssignSelected}
        onCancel={() => setAssignSelectedTaskIds([])}
      />

      <ReviewerAssignmentModal
        show={showReviewerModal}
        onClose={() => setShowReviewerModal(false)}
        projectUsers={projectUsers}
        onAssign={handleAssignReviewers}
        totalTasks={scopedAnnotationTasks.length}
      />
    </>
  );
};

export default CampaignTasksPage;
