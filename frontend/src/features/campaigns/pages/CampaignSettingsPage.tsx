import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TaskAssignmentModal } from '~/features/campaigns/settings/TaskAssignmentModal';
import { ReviewerAssignmentModal, type AssignmentPattern } from '~/features/campaigns/settings/ReviewerAssignmentModal';
import { LoadingSpinner } from 'src/shared/ui/LoadingSpinner';
import { LoadingOverlay } from 'src/shared/ui/LoadingOverlay';
import { ConfirmDialog } from 'src/shared/ui/ConfirmDialog';
import TabNavigator from 'src/shared/ui/TabNavigator';
import { DeleteCampaignDialog } from '~/features/campaigns/components/DeleteCampaignDialog';
import GeneralSettingsTab from '~/features/campaigns/settings/tabs/GeneralSettingsTab';
import ImageryTab from '~/features/campaigns/settings/tabs/ImageryTab';
import TimeseriesTab from '~/features/campaigns/settings/tabs/TimeseriesTab';
import TasksTab from '~/features/campaigns/settings/tabs/TasksTab';
import UsersTab from '~/features/campaigns/settings/tabs/UsersTab';
import { useLayoutStore } from 'src/features/layout/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';

import {
  createImagery,
  deleteImagery,
  updateImagery,
  createTimeseriesForCampaign,
  getAllAnnotationTasks,
  getCampaign,
  getCampaignUsers,
  ingestAnnotationTasksFromCsv,
  assignTasksToUsers,
  unassignUserFromTask,
  assignReviewers,
  deleteAnnotationTasks,
  deleteCampaign,
  deleteTimeseries,
  type AnnotationTaskOut,
  type CampaignOut,
  type CampaignUserOut,
  type ImageryOut,
  type ImageryBulkCreate,
  type ImageryCreate,
  type TimeSeriesCreate,
  type TimeSeriesOut,
  type GenerateTasksResponse,
  updateCampaignName,
  updateCampaignBbox,
} from '~/api/client';

export const CampaignSettingsPage = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const numericCampaignId = Number(campaignId);

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'general' | 'imagery' | 'tasks' | 'users' | 'timeseries'
  >('general');

  // Form states
  const [campaignName, setCampaignName] = useState('');
  const [imagery, setImagery] = useState<ImageryOut[]>([]);
  const [newImagery, setNewImagery] = useState<ImageryCreate[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const [annotationTasks, setAnnotationTasks] = useState<AnnotationTaskOut[]>([]);
  const [campaignUsers, setCampaignUsers] = useState<CampaignUserOut[]>([]);
  const [taskFile, setTaskFile] = useState<File | null>(new File([], ''));
  const [uploadingTasks, setUploadingTasks] = useState(false);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [showReviewerModal, setShowReviewerModal] = useState(false);
  const [timeseries, setTimeseries] = useState<TimeSeriesOut[]>([]);
  const [newTimeseries, setNewTimeseries] = useState<TimeSeriesCreate[]>([]);

  // Confirm dialog states
  const [deleteConfirm, setDeleteConfirm] = useState<{
    imageryId?: number;
    timeseriesId?: number;
  } | null>(null);
  const [showDeleteCampaignDialog, setShowDeleteCampaignDialog] = useState(false);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaign.id}/annotate` },
        { label: 'Settings' },
      ]);
    }
  }, [campaign, setBreadcrumbs]);

  // Load campaign data (core data only)
  useEffect(() => {
    if (!campaignId || Number.isNaN(numericCampaignId)) return;

    const loadCampaign = async () => {
      try {
        setLoading(true);
        const { data } = await getCampaign({ path: { campaign_id: numericCampaignId } });
        setCampaign(data!);
        setCampaignName(data!.name);
        setImagery(data!.imagery);
        setTimeseries(data!.time_series);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load campaign';
        showAlert(message, 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadCampaign();
  }, [numericCampaignId, showAlert]);

  // Lazy load annotation tasks when tasks tab is active
  useEffect(() => {
    if (activeTab !== 'tasks' || annotationTasks.length > 0) return;

    const loadTasks = async () => {
      try {
        const { data } = await getAllAnnotationTasks({
          path: { campaign_id: numericCampaignId },
        });
        setAnnotationTasks(data!.tasks);
      } catch (err) {
        console.error('Failed to load annotation tasks', err);
        showAlert('Failed to load annotation tasks', 'error');
      }
    };

    loadTasks();
  }, [activeTab, numericCampaignId, annotationTasks.length, showAlert]);

  // Lazy load campaign users when users or tasks tab is active (both need users data)
  useEffect(() => {
    if ((activeTab !== 'users' && activeTab !== 'tasks') || campaignUsers.length > 0) return;

    const loadUsers = async () => {
      try {
        const { data } = await getCampaignUsers({
          path: { campaign_id: numericCampaignId },
        });
        setCampaignUsers(data!.users);
      } catch (err) {
        console.error('Failed to load campaign users', err);
        showAlert('Failed to load campaign users', 'error');
      }
    };

    loadUsers();
  }, [activeTab, numericCampaignId, campaignUsers.length, showAlert]);

  const handleSaveName = async () => {
    if (!campaign || campaignName === campaign.name) return;
    try {
      setSaving(true);
      await updateCampaignName({
        path: { campaign_id: numericCampaignId },
        body: { name: campaignName },
      });

      // Update local state immediately
      setCampaign({ ...campaign, name: campaignName });

      showAlert('Campaign name updated successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save campaign name';
      showAlert(message, 'error');
      console.error(err);
      setCampaignName(campaign.name);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!campaign) return;
    try {
      setSaving(true);
      await updateCampaignBbox({
        path: { campaign_id: numericCampaignId },
        body: {
          bbox_west: campaign.settings.bbox_west,
          bbox_east: campaign.settings.bbox_east,
          bbox_north: campaign.settings.bbox_north,
          bbox_south: campaign.settings.bbox_south,
        },
      });

      // Local state is already updated via the onChange handler, no need to update again

      showAlert('Campaign settings updated successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      showAlert(message, 'error');
      console.error(err);

      // Reload campaign to revert changes on error
      try {
        const { data } = await getCampaign({ path: { campaign_id: numericCampaignId } });
        setCampaign(data!);
      } catch (reloadErr) {
        console.error('Failed to reload campaign after error', reloadErr);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddImagery = async () => {
    if (newImagery.length === 0) return;
    try {
      setSaving(true);
      const imageryToCreate: ImageryBulkCreate = { items: newImagery };
      const { data } = await createImagery({
        path: { campaign_id: numericCampaignId },
        body: imageryToCreate,
      });
      setImagery([...imagery, ...data!.new_items]);
      setNewImagery([]);
      showAlert(`${data!.new_items.length} imagery source(s) added successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add imagery';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateImagery = async (imageryId: number, updates: Partial<ImageryCreate>) => {
    try {
      setSaving(true);
      
      // Filter out temporal fields that cannot be updated
      const { start_ym, end_ym, window_interval, window_unit, slicing_interval, slicing_unit, ...allowedUpdates } = updates;
      
      // Call the API
      const { data, error } = await updateImagery({
        path: { 
          campaign_id: numericCampaignId, 
          imagery_id: imageryId 
        },
        body: allowedUpdates,
      });

      if (error) {
        throw new Error('Failed to update imagery');
      }

      // Update the local state with the response from the server
      if (data) {
        setImagery(
          imagery.map((img) => {
            if (img.id === imageryId) {
              return data;
            }
            return img;
          })
        );
      }
      
      showAlert('Imagery updated successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update imagery';
      showAlert(message, 'error');
      console.error(err);
      // Reload campaign to revert changes on error
      try {
        const { data } = await getCampaign({ path: { campaign_id: numericCampaignId } });
        if (data) {
          setImagery(data.imagery);
        }
      } catch (reloadErr) {
        console.error('Failed to reload campaign:', reloadErr);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteImagery = async () => {
    if (!deleteConfirm?.imageryId) return;

    try {
      setSaving(true);

      await deleteImagery({
        path: {
          campaign_id: numericCampaignId,
          imagery_id: deleteConfirm.imageryId,
        },
      });

      // Update local state immediately
      setImagery(imagery.filter((img) => img.id !== deleteConfirm.imageryId));
      setDeleteConfirm(null);
      showAlert('Imagery deleted successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete imagery';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTimeseries = async () => {
    if (!deleteConfirm?.timeseriesId) return;

    try {
      setSaving(true);

      await deleteTimeseries({
        path: {
          campaign_id: numericCampaignId,
          timeseries_id: deleteConfirm.timeseriesId,
        },
      });

      // Update local state immediately
      setTimeseries(timeseries.filter((ts) => ts.id !== deleteConfirm.timeseriesId));
      setDeleteConfirm(null);
      showAlert('Timeseries deleted successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete timeseries';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCampaign = async () => {
    if (!campaign) return;

    try {
      setSaving(true);

      await deleteCampaign({
        path: { campaign_id: numericCampaignId },
      });

      showAlert('Campaign deleted successfully', 'success');
      setShowDeleteCampaignDialog(false);

      // Navigate to campaigns list after successful deletion
      navigate('/campaigns');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete campaign';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadAnnotationTasks = async () => {
    if (!taskFile) return;
    try {
      setUploadingTasks(true);
      const { data } = await ingestAnnotationTasksFromCsv({
        path: { campaign_id: numericCampaignId },
        body: { file: taskFile },
      });

      setTaskFile(null);
      showAlert('Annotation task(s) uploaded successfully', 'success');

      // Reload annotation tasks
      const { data: tasksData } = await getAllAnnotationTasks({
        path: { campaign_id: numericCampaignId },
      });
      setAnnotationTasks(tasksData!.tasks);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload annotation tasks';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setUploadingTasks(false);
    }
  };

  const handleTasksGenerated = async (response: GenerateTasksResponse) => {
    showAlert(`${response.num_tasks_created} tasks generated successfully`, 'success');

    // Reload annotation tasks to show the new ones
    try {
      const { data: tasksData } = await getAllAnnotationTasks({
        path: { campaign_id: numericCampaignId },
      });
      setAnnotationTasks(tasksData!.tasks);
    } catch (err) {
      console.error('Failed to reload annotation tasks', err);
    }
  };

  const handleAddTimeseries = async () => {
    if (newTimeseries.length === 0) return;
    try {
      setSaving(true);
      const timeSeriesCleaned = newTimeseries.map((ts) => ({
        ...ts,
        start_ym: ts.start_ym ? ts.start_ym.replace(/-/g, '') : ts.start_ym,
        end_ym: ts.end_ym ? ts.end_ym.replace(/-/g, '') : ts.end_ym,
      }));

      const timeseriesToCreate = { timeseries: timeSeriesCleaned };
      const { data } = await createTimeseriesForCampaign({
        path: { campaign_id: numericCampaignId },
        body: timeseriesToCreate,
      });
      setTimeseries([...timeseries, ...data!.new_items]);
      setNewTimeseries([]);
      showAlert(`${data!.new_items.length} timeseries added successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add timeseries';
      showAlert(message, 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAssignSingleTask = async (taskId: number, userId: string) => {
    try {
      await assignTasksToUsers({
        path: { campaign_id: numericCampaignId },
        body: { task_assignments: { [taskId]: [userId] } },
      });

      // Refresh tasks to get updated assignments
      const { data } = await getAllAnnotationTasks({
        path: { campaign_id: numericCampaignId },
      });
      setAnnotationTasks(data!.tasks);

      showAlert('Task assigned successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign task';
      showAlert(message, 'error');
      console.error(err);
      throw err;
    }
  };

  const handleUnassignTask = async (taskId: number, userId: string) => {
    try {
      await unassignUserFromTask({
        path: { 
          campaign_id: numericCampaignId,
          task_id: taskId,
          user_id: userId
        },
      });

      // Refresh tasks to get updated assignments
      const { data } = await getAllAnnotationTasks({
        path: { campaign_id: numericCampaignId },
      });
      setAnnotationTasks(data!.tasks);

      showAlert('User unassigned successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unassign user';
      showAlert(message, 'error');
      console.error(err);
      throw err;
    }
  };

  const handleBulkAssignTasks = async (assignments: { [taskId: number]: string[] }) => {
    try {
      setSaving(true);

      const taskAssignments: { [key: string]: string[] } = {};
      Object.entries(assignments).forEach(([taskId, userIds]) => {
        taskAssignments[taskId] = userIds;
      });

      await assignTasksToUsers({
        path: { campaign_id: numericCampaignId },
        body: { task_assignments: taskAssignments },
      });

      // Refresh tasks to get updated assignments
      const { data } = await getAllAnnotationTasks({
        path: { campaign_id: numericCampaignId },
      });
      setAnnotationTasks(data!.tasks);

      showAlert(`${Object.keys(assignments).length} task(s) assigned successfully`, 'success');
      setShowAssignmentModal(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign tasks';
      showAlert(message, 'error');
      console.error(err);
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
          path: { campaign_id: numericCampaignId },
          body: {
            pattern: 'percentage',
            percentage: pattern.percentage,
            num_reviewers: pattern.reviewersPerTask,
            reviewer_ids: pattern.reviewerIds,
          },
        });
        showAlert(
          `Assigned ${pattern.reviewersPerTask} reviewers to ${pattern.percentage}% of tasks`,
          'success'
        );
      } else if (pattern.type === 'fixed') {
        await assignReviewers({
          path: { campaign_id: numericCampaignId },
          body: {
            pattern: 'fixed',
            num_tasks: pattern.numTasks,
            fixed_num_reviewers: pattern.reviewersPerTask,
            reviewer_ids: pattern.reviewerIds,
          },
        });
        showAlert(
          `Assigned ${pattern.reviewersPerTask} reviewers to ${pattern.numTasks} tasks`,
          'success'
        );
      }

      // Refresh tasks to get updated assignments
      const { data } = await getAllAnnotationTasks({
        path: { campaign_id: numericCampaignId },
      });
      setAnnotationTasks(data!.tasks);

      setShowReviewerModal(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign reviewers';
      showAlert(message, 'error');
      console.error(err);
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
        path: { campaign_id: numericCampaignId },
        body: { task_ids: taskIds },
      });

      // Remove deleted tasks from local state
      setAnnotationTasks((tasks) => tasks.filter((task) => !taskIds.includes(task.id)));

      showAlert(`${taskIds.length} task(s) deleted successfully`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete tasks';
      showAlert(message, 'error');
      console.error(err);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading campaign settings..." />
      </div>
    );
  }

  if (!campaign) return null;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-8">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-neutral-900 mb-2">
                {capitalizeFirst(campaign.name)}
              </h1>
              <p className="text-sm text-neutral-500">
                Manage your campaign settings, imagery, and users
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigate(`/campaigns/${campaignId}/annotations`)}
                className="px-4 py-2 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-300 rounded-lg hover:bg-brand-100 transition-colors"
                type="button"
              >
                View Annotations
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <TabNavigator
            items={[
              { id: 'general', label: 'General Settings' },
              { id: 'imagery', label: 'Imagery' },
              { id: 'timeseries', label: 'Timeseries' },
              ...(campaign?.mode !== 'open' ? [{ id: 'tasks', label: 'Annotation Tasks' }] : []),
              { id: 'users', label: 'Users' },
            ]}
            activeId={activeTab}
            onChange={(id) => setActiveTab(id as any)}
          />

          {/* Tab Content */}
          {activeTab === 'general' && (
            <GeneralSettingsTab
              campaign={campaign!}
              campaignName={campaignName}
              setCampaignName={setCampaignName}
              saving={saving}
              onSaveName={handleSaveName}
              onSaveSettings={handleSaveSettings}
              onUpdateSettings={(updates) =>
                setCampaign({ ...campaign!, settings: { ...campaign!.settings, ...updates } })
              }
              onOpenDelete={() => setShowDeleteCampaignDialog(true)}
            />
          )}

          {activeTab === 'imagery' && (
            <ImageryTab
              newImagery={newImagery}
              setNewImagery={setNewImagery}
              selectedPreset={selectedPreset}
              setSelectedPreset={setSelectedPreset}
              imagery={imagery}
              handleAddImagery={handleAddImagery}
              handleUpdateImagery={handleUpdateImagery}
              setDeleteConfirm={setDeleteConfirm}
              saving={saving}
            />
          )}

          {activeTab === 'timeseries' && (
            <TimeseriesTab
              newTimeseries={newTimeseries}
              setNewTimeseries={setNewTimeseries}
              timeseries={timeseries}
              handleAddTimeseries={handleAddTimeseries}
              setDeleteConfirm={setDeleteConfirm}
              saving={saving}
              campaignName={campaignName}
              imagery={imagery}
              campaignMode={campaign?.mode || 'tasks'}
              campaignSettings={campaign?.settings || {}}
            />
          )}

          {activeTab === 'tasks' && (
            <TasksTab
              annotationTasks={annotationTasks}
              campaignUsers={campaignUsers}
              taskFile={taskFile}
              setTaskFile={setTaskFile}
              uploadingTasks={uploadingTasks}
              handleUploadAnnotationTasks={handleUploadAnnotationTasks}
              handleTasksGenerated={handleTasksGenerated}
              onTaskGenerationError={(msg) => showAlert(msg, 'error')}
              onOpenBulkAssign={() => setShowAssignmentModal(true)}
              onOpenReviewerAssign={() => setShowReviewerModal(true)}
              handleAssignSingleTask={handleAssignSingleTask}
              handleUnassignTask={handleUnassignTask}
              handleDeleteTasks={handleDeleteTasks}
              campaignId={numericCampaignId}
              bbox={
                campaign
                  ? {
                      west: campaign.settings.bbox_west,
                      south: campaign.settings.bbox_south,
                      east: campaign.settings.bbox_east,
                      north: campaign.settings.bbox_north,
                    }
                  : undefined
              }
            />
          )}

          {activeTab === 'users' && (
            <UsersTab
              campaignId={numericCampaignId}
              onError={(msg) => showAlert(msg, 'error')}
              onSuccess={(msg) => showAlert(msg, 'success')}
              campaignUsers={campaignUsers}
            />
          )}
        </div>
      </div>

      {/* Global Modals */}
      <LoadingOverlay visible={saving && !deleteConfirm} text="Saving..." />

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        title={deleteConfirm?.imageryId ? 'Delete Imagery Source?' : 'Delete Timeseries?'}
        description={
          deleteConfirm?.imageryId
            ? 'This action cannot be undone. The imagery source will be permanently removed from the campaign.'
            : 'This action cannot be undone. The timeseries will be permanently removed from the campaign.'
        }
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
        isLoading={saving}
        onConfirm={deleteConfirm?.imageryId ? handleDeleteImagery : handleDeleteTimeseries}
        onCancel={() => setDeleteConfirm(null)}
      />

      <TaskAssignmentModal
        isOpen={showAssignmentModal}
        onClose={() => setShowAssignmentModal(false)}
        tasks={annotationTasks}
        campaignUsers={campaignUsers}
        onAssign={handleBulkAssignTasks}
      />

      <ReviewerAssignmentModal
        show={showReviewerModal}
        onClose={() => setShowReviewerModal(false)}
        campaignUsers={campaignUsers}
        onAssign={handleAssignReviewers}
        totalTasks={annotationTasks.length}
      />

      <DeleteCampaignDialog
        isOpen={showDeleteCampaignDialog}
        campaignName={campaign?.name || ''}
        onConfirm={handleDeleteCampaign}
        onCancel={() => setShowDeleteCampaignDialog(false)}
        isLoading={saving}
      />
    </>
  );
};
