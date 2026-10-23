import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('campaigns');
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

  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name, t('tasksPage.breadcrumb'));

  const { tasks: annotationTasks, loading: tasksLoading } = useCampaignTasks(campaignId);
  const { taskSets, loading: taskSetsLoading } = useCampaignTaskSets(campaignId);

  // Assignable users are the owning project's members, so this waits for the
  // campaign to say which project to ask about.
  const { data: projectUsersData } = useQuery({
    ...getProjectUsersOptions({ path: { project_id: campaign?.project_id ?? 0 } }),
    enabled: campaign !== undefined,
    meta: { errorMessage: t('errors.loadProjectMembers') },
  });
  const projectUsers = projectUsersData?.users ?? NO_USERS;

  const reloadAnnotationTasks = useRefreshCampaignTasks(campaignId);
  const reloadTaskSets = useRefreshCampaignTaskSets(campaignId);
  const reloadTasksAndSets = useRefreshCampaignWork(campaignId);

  const uploadGeojson = useMutation({
    ...ingestAnnotationTasksFromGeojsonMutation(),
    meta: { errorMessage: t('tasksPage.errors.upload') },
  });
  const uploadCsv = useMutation({
    ...ingestAnnotationTasksFromCsvMutation(),
    meta: { errorMessage: t('tasksPage.errors.upload') },
  });
  const createSet = useMutation({
    ...createTaskSetMutation(),
    meta: { errorMessage: t('tasksPage.errors.createSet') },
    onSuccess: reloadTaskSets,
  });
  const renameSet = useMutation({
    ...renameTaskSetMutation(),
    meta: { errorMessage: t('tasksPage.errors.renameSet') },
    onSuccess: reloadTaskSets,
  });
  const deleteSet = useMutation({
    ...deleteTaskSetMutation(),
    meta: { errorMessage: t('tasksPage.errors.deleteSet') },
    onSuccess: reloadTasksAndSets,
  });
  const moveTasks = useMutation({
    ...moveTasksToSetMutation(),
    meta: { errorMessage: t('tasksPage.errors.move') },
    onSuccess: reloadTasksAndSets,
  });
  const assignTasks = useMutation({
    ...assignTasksToUsersMutation(),
    meta: reportedByCaller(t('tasksPage.errors.assign')),
    onSuccess: reloadTasksAndSets,
  });
  const assignReviewersTo = useMutation({
    ...assignReviewersMutation(),
    meta: reportedByCaller(t('reviewerAssign.failed')),
    onSuccess: reloadAnnotationTasks,
  });
  const unassignTasks = useMutation({
    ...batchUnassignTasksMutation(),
    meta: reportedByCaller(t('tasksPage.errors.unassign')),
    onSuccess: reloadAnnotationTasks,
  });
  const deleteTasks = useMutation({
    ...deleteAnnotationTasksMutation(),
    meta: reportedByCaller(t('tasksPage.errors.delete')),
    onSuccess: reloadTasksAndSets,
  });

  const uploadingTasks = uploadGeojson.isPending || uploadCsv.isPending;
  const saving =
    assignTasks.isPending ||
    assignReviewersTo.isPending ||
    unassignTasks.isPending ||
    deleteTasks.isPending;

  // Without a URL param the scope starts on the campaign's first (default) set;
  // "All tasks" is an explicit choice carried as taskSet=all. The requested set is
  // trusted until the sets load, so the scope does not flash to "All tasks" first.
  const taskSetParam = searchParams.get('taskSet');
  const requestedSetId = taskSetParam !== null ? Number(taskSetParam) : null;
  const taskScope: TaskScope =
    requestedSetId !== null && (taskSetsLoading || taskSets.some((s) => s.id === requestedSetId))
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
        : annotationTasks.filter((task) => task.task_set_id === taskScope),
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

  const handleUploadAnnotationTasks = async (): Promise<boolean> => {
    if (!taskFile || taskScope === 'all') return false;
    const body = { file: taskFile, task_set_id: taskScope } as never;
    const name = taskFile.name.toLowerCase();
    const upload = name.endsWith('.geojson') || name.endsWith('.json') ? uploadGeojson : uploadCsv;
    try {
      await upload.mutateAsync({ path, body });
    } catch {
      return false;
    }
    setTaskFile(null);
    showAlert(t('tasksPage.toasts.uploaded'), 'success');
    reloadTasksAndSets();
    return true;
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
      {
        onSuccess: () =>
          showAlert(t('tasksPage.toasts.moved', { count: taskIds.length }), 'success'),
      }
    );
  };

  const handleTasksGenerated = (response: GenerateTasksResponse) => {
    showAlert(t('tasksPage.toasts.generated', { count: response.num_tasks_created }), 'success');
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
    showAlert(t('tasksPage.toasts.assignedBulk', { count: result.total_assigned }), 'success');
    setShowAssignmentModal(false);
  };

  const handleAssignSelected = async (mapping: Record<number, string[]>) => {
    const result = await assignTasks.mutateAsync({
      path,
      body: { strategy: 'explicit', task_assignments: Object.fromEntries(Object.entries(mapping)) },
    });
    showAlert(t('tasksPage.toasts.assigned', { count: result.total_assigned }), 'success');
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
        ? t('tasksPage.toasts.reviewersPercentage', {
            count: pattern.reviewersPerTask,
            percentage: pattern.percentage,
          })
        : t('tasksPage.toasts.reviewersFixed', {
            count: pattern.reviewersPerTask,
            tasks: pattern.numTasks,
          }),
      'success'
    );
    setShowReviewerModal(false);
  };

  const handleBatchUnassignTasks = async (taskIds: number[]) => {
    if (taskIds.length === 0) {
      showAlert(t('tasksPage.toasts.noneSelected'), 'error');
      return;
    }
    await unassignTasks.mutateAsync({ path, body: { task_ids: taskIds } });
    showAlert(t('tasksPage.toasts.unassigned', { count: taskIds.length }), 'success');
  };

  const handleDeleteTasks = async (taskIds: number[], deleteAnnotations: boolean) => {
    if (taskIds.length === 0) {
      showAlert(t('tasksPage.toasts.noneSelected'), 'error');
      return;
    }
    await deleteTasks.mutateAsync({
      path,
      body: { task_ids: taskIds, delete_annotations: deleteAnnotations },
    });
    showAlert(t('tasksPage.toasts.deleted', { count: taskIds.length }), 'success');
  };

  if (!loading && !campaign) return null;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              {campaign ? (
                <h1 className="page-title">
                  {t('tasksPage.title', { name: capitalizeFirst(campaign.name) })}
                </h1>
              ) : (
                <Skeleton className="h-7 w-52" />
              )}
              <p className="page-subtitle">
                {isAdmin ? t('tasksPage.subtitleAdmin') : t('tasksPage.subtitle')}
              </p>
            </div>
            {campaign && (
              <div className="flex items-center gap-3">
                <ExportDropdown
                  campaignId={campaignId}
                  campaign={campaign}
                  disabled={annotationTasks.length === 0}
                  hasConflicts={annotationTasks.some((task) => task.task_status === 'conflicting')}
                />
                <Button onClick={() => navigate(campaignPath(projectId, campaignId, 'annotate'))}>
                  {t('startAnnotating')}
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
                    loadingTasks={tasksLoading || taskSetsLoading}
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
            <SkeletonForm sections={3} />
          )}
        </FadeIn>
      </div>

      {/* Global Modals */}
      <LoadingOverlay visible={saving} text={t('savingOverlay')} />

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
