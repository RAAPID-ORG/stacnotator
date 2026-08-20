import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExportDropdown } from '~/features/campaigns/components/review/ExportDropdown';
import { ImportFeaturesSection } from '~/features/campaigns/components/settings/ImportFeaturesSection';
import { Button } from '~/shared/ui/forms';
import { IconChevronDown, IconChevronRight } from '~/shared/ui/Icons';
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
import { handleError } from '~/shared/utils/errorHandler';
import { FadeIn } from '~/shared/ui/motion';

import {
  getAllAnnotationTasks,
  getCampaign,
  getProjectUsers,
  ingestAnnotationTasksFromCsv,
  ingestAnnotationTasksFromGeojson,
  assignTasksToUsers,
  batchUnassignTasks,
  assignReviewers,
  deleteAnnotationTasks,
  listTaskSets,
  createTaskSet,
  renameTaskSet,
  deleteTaskSet,
  moveTasksToSet,
  type AnnotationTaskOut,
  type CampaignOut,
  type GenerateTasksResponse,
  type ProjectUserOut,
  type TaskSetOut,
} from '~/api/client';

export const CampaignTasksPage = () => {
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const navigate = useNavigate();
  const [showImport, setShowImport] = useState(false);

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const [annotationTasks, setAnnotationTasks] = useState<AnnotationTaskOut[]>([]);
  const [taskSets, setTaskSets] = useState<TaskSetOut[]>([]);
  const [projectUsers, setProjectUsers] = useState<ProjectUserOut[]>([]);
  const [taskFile, setTaskFile] = useState<File | null>(new File([], ''));
  const [uploadingTasks, setUploadingTasks] = useState(false);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [showReviewerModal, setShowReviewerModal] = useState(false);
  const [assignSelectedTaskIds, setAssignSelectedTaskIds] = useState<number[]>([]);

  // Campaign wins over the URL param, which only stands in until it loads and
  // can be wrong outright on a hand-edited /projects/<id>/campaigns/... URL.
  const projectId = campaign?.project_id ?? routeProjectId;
  const showAlert = useLayoutStore((state) => state.showAlert);

  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name, 'Tasks');

  const reloadTaskSets = useCallback(async () => {
    const { data, error } = await listTaskSets({ path: { campaign_id: campaignId } });
    if (error) {
      handleError(error, 'Failed to load task sets');
      return;
    }
    if (data) {
      setTaskSets(data);
    }
  }, [campaignId]);

  // Load campaign, tasks, task sets, and users up front - this page is
  // dedicated to task management so there's no tab-gated lazy loading.
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [campaignRes, tasksRes] = await Promise.all([
          getCampaign({ path: { campaign_id: campaignId } }),
          getAllAnnotationTasks({ path: { campaign_id: campaignId } }),
        ]);
        setCampaign(campaignRes.data ?? null);
        setAnnotationTasks(tasksRes.data?.tasks ?? []);
        // Assignable users are the owning project's members, so this has to
        // wait for the campaign to know which project to ask about.
        if (campaignRes.data) {
          const usersRes = await getProjectUsers({
            path: { project_id: campaignRes.data.project_id },
          });
          setProjectUsers(usersRes.data?.users ?? []);
        }
        await reloadTaskSets();
      } catch (err) {
        handleError(err, 'Failed to load campaign');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [campaignId, reloadTaskSets]);

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

  const handleUploadAnnotationTasks = async () => {
    if (!taskFile || taskScope === 'all') return;
    try {
      setUploadingTasks(true);
      const name = taskFile.name.toLowerCase();

      if (name.endsWith('.geojson') || name.endsWith('.json')) {
        await ingestAnnotationTasksFromGeojson({
          path: { campaign_id: campaignId },
          body: { file: taskFile, task_set_id: taskScope } as never,
        });
      } else {
        await ingestAnnotationTasksFromCsv({
          path: { campaign_id: campaignId },
          body: { file: taskFile, task_set_id: taskScope } as never,
        });
      }

      setTaskFile(null);
      showAlert('Annotation task(s) uploaded successfully', 'success');

      // Reload annotation tasks
      const { data: tasksData } = await getAllAnnotationTasks({
        path: { campaign_id: campaignId },
      });
      setAnnotationTasks(tasksData!.tasks);
      await reloadTaskSets();
    } catch (err) {
      handleError(err, 'Failed to upload annotation tasks');
    } finally {
      setUploadingTasks(false);
    }
  };

  const reloadAnnotationTasks = async () => {
    try {
      const { data } = await getAllAnnotationTasks({
        path: { campaign_id: campaignId },
      });
      setAnnotationTasks(data!.tasks);
    } catch (err) {
      handleError(err, 'Failed to reload annotation tasks', { showUser: false });
    }
  };

  const handleCreateTaskSet = async (name: string): Promise<number | null> => {
    try {
      const { data, error } = await createTaskSet({
        path: { campaign_id: campaignId },
        body: { name },
      });
      if (error) throw error;
      await reloadTaskSets();
      return data?.id ?? null;
    } catch (err) {
      handleError(err, 'Failed to create task set');
      return null;
    }
  };

  const handleRenameTaskSet = async (id: number, name: string) => {
    try {
      const { error } = await renameTaskSet({
        path: { campaign_id: campaignId, task_set_id: id },
        body: { name },
      });
      if (error) throw error;
      await reloadTaskSets();
    } catch (err) {
      handleError(err, 'Failed to rename task set');
    }
  };

  const handleDeleteTaskSet = async (id: number): Promise<boolean> => {
    try {
      const { error } = await deleteTaskSet({
        path: { campaign_id: campaignId, task_set_id: id },
      });
      if (error) throw error;
      await Promise.all([reloadTaskSets(), reloadAnnotationTasks()]);
      return true;
    } catch (err) {
      handleError(err, 'Failed to delete task set');
      return false;
    }
  };

  const handleMoveTasks = async (taskIds: number[], taskSetId: number) => {
    try {
      const { error } = await moveTasksToSet({
        path: { campaign_id: campaignId, task_set_id: taskSetId },
        body: { task_ids: taskIds },
      });
      if (error) throw error;
      await Promise.all([reloadAnnotationTasks(), reloadTaskSets()]);
      showAlert(`Moved ${taskIds.length} task(s)`, 'success');
    } catch (err) {
      handleError(err, 'Failed to move tasks');
    }
  };

  const handleTasksGenerated = async (response: GenerateTasksResponse) => {
    showAlert(`${response.num_tasks_created} tasks generated successfully`, 'success');

    // Reload annotation tasks to show the new ones
    try {
      const { data: tasksData } = await getAllAnnotationTasks({
        path: { campaign_id: campaignId },
      });
      setAnnotationTasks(tasksData!.tasks);
      await reloadTaskSets();
    } catch (err) {
      handleError(err, 'Failed to reload annotation tasks', { showUser: false });
    }
  };

  const handleBulkAssignTasks = async (intent: BulkAssignIntent) => {
    try {
      setSaving(true);

      const body = {
        ...(intent.strategy === 'even'
          ? { strategy: 'even' as const, user_ids: intent.userIds }
          : { strategy: 'fixed_per_user' as const, user_task_counts: intent.userTaskCounts }),
        ...taskScopeBody,
      };

      const { data } = await assignTasksToUsers({
        path: { campaign_id: campaignId },
        body,
      });

      // Refresh tasks to get updated assignments
      const { data: tasksData } = await getAllAnnotationTasks({
        path: { campaign_id: campaignId },
      });
      setAnnotationTasks(tasksData!.tasks);

      showAlert(`${data!.total_assigned} task(s) assigned successfully`, 'success');
      setShowAssignmentModal(false);
    } catch (err) {
      handleError(err, 'Failed to assign tasks');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleAssignSelected = async (mapping: Record<number, string[]>) => {
    try {
      setSaving(true);

      const { data } = await assignTasksToUsers({
        path: { campaign_id: campaignId },
        body: {
          strategy: 'explicit',
          task_assignments: Object.fromEntries(Object.entries(mapping)),
        },
      });

      const { data: tasksData } = await getAllAnnotationTasks({
        path: { campaign_id: campaignId },
      });
      setAnnotationTasks(tasksData!.tasks);
      await reloadTaskSets();

      showAlert(`${data!.total_assigned} task(s) assigned`, 'success');
      setAssignSelectedTaskIds([]);
    } catch (err) {
      handleError(err, 'Failed to assign selected tasks');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleAssignReviewers = async (pattern: AssignmentPattern) => {
    try {
      setSaving(true);

      if (pattern.type === 'percentage') {
        await assignReviewers({
          path: { campaign_id: campaignId },
          body: {
            pattern: 'percentage',
            percentage: pattern.percentage,
            num_reviewers: pattern.reviewersPerTask,
            reviewer_ids: pattern.reviewerIds,
            ...taskScopeBody,
          },
        });
        showAlert(
          `Assigned ${pattern.reviewersPerTask} reviewers to ${pattern.percentage}% of tasks`,
          'success'
        );
      } else if (pattern.type === 'fixed') {
        await assignReviewers({
          path: { campaign_id: campaignId },
          body: {
            pattern: 'fixed',
            num_tasks: pattern.numTasks,
            fixed_num_reviewers: pattern.reviewersPerTask,
            reviewer_ids: pattern.reviewerIds,
            ...taskScopeBody,
          },
        });
        showAlert(
          `Assigned ${pattern.reviewersPerTask} reviewers to ${pattern.numTasks} tasks`,
          'success'
        );
      }

      // Refresh tasks to get updated assignments
      const { data } = await getAllAnnotationTasks({
        path: { campaign_id: campaignId },
      });
      setAnnotationTasks(data!.tasks);

      setShowReviewerModal(false);
    } catch (err) {
      handleError(err, 'Failed to assign reviewers');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleBatchUnassignTasks = async (taskIds: number[]) => {
    if (taskIds.length === 0) {
      showAlert('No tasks selected', 'error');
      return;
    }

    try {
      setSaving(true);

      await batchUnassignTasks({
        path: { campaign_id: campaignId },
        body: { task_ids: taskIds },
      });

      const { data } = await getAllAnnotationTasks({
        path: { campaign_id: campaignId },
      });
      setAnnotationTasks(data!.tasks);

      showAlert(`Unassigned all users from ${taskIds.length} task(s)`, 'success');
    } catch (err) {
      handleError(err, 'Failed to unassign tasks');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTasks = async (taskIds: number[]) => {
    if (taskIds.length === 0) {
      showAlert('No tasks selected', 'error');
      return;
    }

    try {
      setSaving(true);

      await deleteAnnotationTasks({
        path: { campaign_id: campaignId },
        body: { task_ids: taskIds },
      });

      // Remove deleted tasks from local state
      setAnnotationTasks((tasks) => tasks.filter((task) => !taskIds.includes(task.id)));
      await reloadTaskSets();

      showAlert(`${taskIds.length} task(s) deleted successfully`, 'success');
    } catch (err) {
      handleError(err, 'Failed to delete tasks');
      throw err;
    } finally {
      setSaving(false);
    }
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
                {isAdmin && (
                  <Button variant="secondary" onClick={() => setShowImport((v) => !v)}>
                    {showImport ? (
                      <IconChevronDown className="w-4 h-4" />
                    ) : (
                      <IconChevronRight className="w-4 h-4" />
                    )}
                    Import annotations
                  </Button>
                )}
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
              {isAdmin && showImport && (
                <div className="surface mb-6">
                  <div className="surface-section">
                    <ImportFeaturesSection
                      campaignId={campaignId}
                      labels={campaign.settings.labels}
                      onSuccess={(msg) => showAlert(msg, 'success')}
                      onError={(msg) => showAlert(msg, 'error')}
                    />
                  </div>
                </div>
              )}

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
