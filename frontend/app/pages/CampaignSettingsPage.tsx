import { Suspense, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BoundingBoxEditor } from '~/components/campaign/shared/BoundingBoxEditor';
import { LabelsEditor } from '~/components/campaign/shared/LabelsEditor';
import { ImageryEditor } from '~/components/campaign/shared/ImageryEditor';
import { IMAGERY_PRESETS, emptyImagery } from '~/components/campaign/shared/imageryPresets';
import { AnnotationTasksTable } from '~/components/campaign/campaign-settings/AnnotationTasksTable';
import { TaskAssignmentModal } from '~/components/campaign/campaign-settings/TaskAssignmentModal';
import { CampaignUsersSection } from '~/components/campaign/campaign-settings/CampaignUsersSection';
import { TaskGenerationSection } from '~/components/campaign/campaign-settings/TaskGenerationSection';
import { TaskLocationsMap } from '~/components/campaign/campaign-settings/TaskLocationsMap';
import { LoadingSpinner } from '~/components/shared/LoadingSpinner';
import { LoadingOverlay } from '~/components/shared/LoadingOverlay';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';
import { DeleteCampaignDialog } from '~/components/shared/DeleteCampaignDialog';
import { useUIStore } from '~/stores/uiStore';
import { capitalizeFirst } from '~/utils/utility';

import {
  createImagery,
  deleteImagery,
  createTimeseriesForCampaign,
  getAllAnnotationTasks,
  getCampaign,
  getCampaignUsers,
  ingestAnnotationTaskFromCsv,
  assignTasksToUsers,
  deleteCampaign,
  deleteTimeseries,
  type AnnotationTaskItemOut,
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
import { StepAddTimeseries } from '~/components/campaign/campaign-create/steps/StepAddTimeseries';

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
  const [annotationTasks, setAnnotationTasks] = useState<AnnotationTaskItemOut[]>([]);
  const [campaignUsers, setCampaignUsers] = useState<CampaignUserOut[]>([]);
  const [taskFile, setTaskFile] = useState<File | null>(null);
  const [uploadingTasks, setUploadingTasks] = useState(false);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [timeseries, setTimeseries] = useState<TimeSeriesOut[]>([]);
  const [newTimeseries, setNewTimeseries] = useState<TimeSeriesCreate[]>([]);

  // Confirm dialog states
  const [deleteConfirm, setDeleteConfirm] = useState<{
    imageryId?: number;
    timeseriesId?: number;
  } | null>(null);
  const [showDeleteCampaignDialog, setShowDeleteCampaignDialog] = useState(false);

  const setBreadcrumbs = useUIStore((state) => state.setBreadcrumbs);
  const showAlert = useUIStore((state) => state.showAlert);

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaign.id}/annotate` },
        { label: 'Settings' },
      ]);
    }
  }, [campaign, setBreadcrumbs]);

  // Load campaign
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

        // Load annotation tasks
        try {
          const { data } = await getAllAnnotationTasks({
            path: { campaign_id: numericCampaignId },
          });
          setAnnotationTasks(data!.tasks);
        } catch (err) {
          console.error('Failed to load annotation tasks', err);
        }

        // Load campaign users
        try {
          const { data } = await getCampaignUsers({
            path: { campaign_id: numericCampaignId },
          });
          setCampaignUsers(data!.users);
        } catch (err) {
          console.error('Failed to load campaign users', err);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load campaign';
        showAlert(message, 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadCampaign();
  }, [campaignId, numericCampaignId]);

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
      // Update the local state immediately for better UX
      setImagery(
        imagery.map((img) => {
          if (img.id === imageryId) {
            return { ...img, ...updates } as ImageryOut;
          }
          return img;
        })
      );
      showAlert('Imagery updated successfully', 'success');
      // TODO: Implement API call when backend endpoint is available
      // await updateImagery({ path: { imagery_id: imageryId }, body: updates });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update imagery';
      showAlert(message, 'error');
      console.error(err);
      // Reload campaign to revert changes on error
      const { data } = await getCampaign({ path: { campaign_id: numericCampaignId } });
      setImagery(data!.imagery);
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
      const { data } = await ingestAnnotationTaskFromCsv({
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
        body: { task_assignments: { [taskId]: userId } },
      });

      // Update local state
      setAnnotationTasks((tasks) =>
        tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                assigned_user: campaignUsers.find((u) => u.user.id === userId)?.user || null,
              }
            : task
        )
      );

      showAlert('Task assigned successfully', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign task';
      showAlert(message, 'error');
      console.error(err);
      throw err;
    }
  };

  const handleBulkAssignTasks = async (assignments: { [taskId: number]: string }) => {
    try {
      setSaving(true);

      // Convert task IDs to strings for API
      const taskAssignments: { [key: string]: string } = {};
      Object.entries(assignments).forEach(([taskId, userId]) => {
        taskAssignments[taskId] = userId;
      });

      await assignTasksToUsers({
        path: { campaign_id: numericCampaignId },
        body: { task_assignments: taskAssignments },
      });

      // Update local state immediately
      setAnnotationTasks((tasks) =>
        tasks.map((task) => {
          const assignedUserId = assignments[task.id];
          if (assignedUserId !== undefined) {
            return {
              ...task,
              assigned_user: campaignUsers.find((u) => u.user.id === assignedUserId)?.user || null,
            };
          }
          return task;
        })
      );

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
          <div className="mb-3">
            <h1 className="text-3xl font-bold text-neutral-900 mb-2">
              {capitalizeFirst(campaign.name)}
            </h1>
            <p className="text-sm text-neutral-500">
              Manage your campaign settings, imagery, and users
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-4 mb-3 border-b border-neutral-300">
            {[
              { id: 'general', label: 'General Settings' },
              { id: 'imagery', label: 'Imagery' },
              { id: 'timeseries', label: 'Timeseries' },
              { id: 'tasks', label: 'Annotation Tasks' },
              { id: 'users', label: 'Users' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-brand-600 text-brand-700 font-medium'
                    : 'border-transparent text-neutral-500 hover:text-brand-700'
                }`}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'general' && (
            <>
              <div className="space-y-3">
                {/* Campaign Name */}
                <div className="bg-white rounded-lg border border-neutral-300 p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 mb-">Campaign Name</h2>
                  <div className="flex gap-4 items-end">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-neutral-700 mb-2">
                        Name
                      </label>
                      <input
                        type="text"
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        disabled={saving}
                        className="w-full border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                      />
                    </div>
                    <button
                      onClick={handleSaveName}
                      disabled={saving || campaignName === campaign.name}
                      className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {saving && (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      )}
                      Save
                    </button>
                  </div>
                </div>

                {/* Bounding Box */}
                <div className="bg-white rounded-lg border border-neutral-300 p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 mb-4">Bounding Box</h2>
                  <BoundingBoxEditor
                    value={{
                      bbox_west: campaign.settings.bbox_west,
                      bbox_south: campaign.settings.bbox_south,
                      bbox_east: campaign.settings.bbox_east,
                      bbox_north: campaign.settings.bbox_north,
                    }}
                    onChange={(updates) => {
                      setCampaign({
                        ...campaign,
                        settings: { ...campaign.settings, ...updates },
                      });
                    }}
                  />
                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="mt-4 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-200 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {saving && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    Save Settings
                  </button>
                </div>

                {/* Labels */}
                <div className="bg-white rounded-lg border border-neutral-300 p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 mb-4">Annotation Labels</h2>
                  <p className="text-sm text-neutral-500 mb-4">
                    Labels are read-only in settings. To add labels, edit during campaign creation.
                  </p>
                  <LabelsEditor
                    value={campaign.settings.labels}
                    onChange={() => {}}
                    readOnly={true}
                  />
                </div>

                {/* Danger Zone - Delete Campaign */}
                <div className="bg-white rounded-lg border border-red-300 p-6">
                  <h2 className="text-lg font-semibold text-red-700 mb-2">Danger Zone</h2>
                  <p className="text-sm text-neutral-600 mb-4">
                    Once you delete a campaign, there is no going back. Please be certain.
                  </p>
                  <button
                    onClick={() => setShowDeleteCampaignDialog(true)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Delete This Campaign
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'imagery' && (
            <>
              <div className="space-y-3">
                {/* Add New Imagery */}
                <div className="bg-white rounded-lg border border-neutral-300 p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 mb-4">
                    Add Imagery Sources
                  </h2>
                  <div className="space-y-4">
                    {newImagery.map((img, index) => (
                      <div key={index} className="p-4">
                        <ImageryEditor
                          value={img}
                          onChange={(updates) => {
                            const updated = newImagery.map((i, idx) =>
                              idx === index ? { ...i, ...updates } : i
                            );
                            setNewImagery(updated);
                          }}
                          onRemove={() => {
                            setNewImagery(newImagery.filter((_, idx) => idx !== index));
                          }}
                        />
                      </div>
                    ))}
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <select
                          value={selectedPreset}
                          onChange={(e) => setSelectedPreset(e.target.value)}
                          className="flex-1 border border-neutral-300 rounded-md px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        >
                          <option value="custom">Custom Configuration</option>
                          {IMAGERY_PRESETS.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            const preset = IMAGERY_PRESETS.find((p) => p.id === selectedPreset);
                            const newItem: ImageryCreate = preset
                              ? { ...preset.template, start_ym: '', end_ym: '' }
                              : emptyImagery();

                            setNewImagery([...newImagery, newItem]);
                            setSelectedPreset('custom'); // Reset to custom after adding
                          }}
                          className="px-4 py-2 border border-neutral-300 rounded-lg hover:bg-neutral-100 transition-colors text-neutral-700 whitespace-nowrap"
                        >
                          + Add
                        </button>
                      </div>

                      {selectedPreset !== 'custom' && (
                        <p className="text-xs text-neutral-600 italic">
                          Preset "{IMAGERY_PRESETS.find((p) => p.id === selectedPreset)?.label}"
                          will be added. You can customize it after adding.
                        </p>
                      )}
                    </div>
                  </div>
                  {newImagery.length > 0 && (
                    <button
                      onClick={handleAddImagery}
                      disabled={saving}
                      className="mt-4 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-200 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {saving && (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      )}
                      Add {newImagery.length} Imagery Source(s)
                    </button>
                  )}
                </div>

                {/* Existing Imagery */}
                <div className="bg-white rounded-lg border border-neutral-300 p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 mb-4">
                    Existing Imagery Sources ({imagery.length})
                  </h2>
                  <div className="space-y-4">
                    {imagery.length === 0 ? (
                      <p className="text-sm text-neutral-500">No imagery sources added yet</p>
                    ) : (
                      imagery.map((img) => (
                        <ImageryEditor
                          key={img.id}
                          value={{
                            ...img,
                            search_body:
                              typeof img.search_body === 'string'
                                ? img.search_body
                                : JSON.stringify(img.search_body),
                          }}
                          onChange={(updates) => handleUpdateImagery(img.id, updates)}
                          onUpdate={() => {}}
                          onRemove={() => setDeleteConfirm({ imageryId: img.id })}
                          showUpdateButton={true}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'timeseries' && (
            <div className="space-y-3">
              {/* Add New Timeseries */}
              <div className="bg-white rounded-lg border border-neutral-300 p-6">
                <h2 className="text-lg font-semibold text-neutral-900 mb-4">Add Timeseries</h2>
                <StepAddTimeseries
                  form={{
                    name: campaignName,
                    mode: campaign?.mode || 'tasks',
                    settings: campaign?.settings || {},
                    imagery_configs: imagery.map((img) => ({
                      ...img,
                      search_body: JSON.stringify(img.search_body),
                    })),
                    timeseries_configs: newTimeseries,
                  }}
                  setForm={(form) => setNewTimeseries(form.timeseries_configs || [])}
                />

                {newTimeseries.length > 0 && (
                  <button
                    type="button"
                    onClick={handleAddTimeseries}
                    disabled={saving}
                    className="mt-4 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-200 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {saving && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    Add {newTimeseries.length} Timeseries
                  </button>
                )}
              </div>

              {/* Existing Timeseries */}
              {timeseries.length > 0 && (
                <div className="bg-white rounded-lg border border-neutral-300 p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 mb-4">
                    Existing Timeseries ({timeseries.length})
                  </h2>
                  <div className="space-y-3">
                    {timeseries.map((ts) => (
                      <div
                        key={ts.id}
                        className="rounded-lg border border-neutral-300 p-4 flex justify-between items-start"
                      >
                        <div>
                          <h4 className="font-medium text-neutral-900">{ts.name}</h4>
                          <p className="text-sm text-neutral-500 mt-1">
                            Start: {ts.start_ym} | End: {ts.end_ym}
                          </p>
                        </div>
                        <button
                          onClick={() => setDeleteConfirm({ timeseriesId: ts.id })}
                          className="text-sm text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'tasks' && (
            <>
              <div className="space-y-3">
                {/* Task Locations Map */}
                {annotationTasks.length > 0 && campaign && (
                  <TaskLocationsMap
                    tasks={annotationTasks}
                    bbox={{
                      west: campaign.settings.bbox_west,
                      south: campaign.settings.bbox_south,
                      east: campaign.settings.bbox_east,
                      north: campaign.settings.bbox_north,
                    }}
                  />
                )}

                {/* Upload Tasks */}
                <div className="bg-white rounded-lg border border-neutral-300 p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 mb-4">
                    Upload Annotation Tasks from CSV
                  </h2>
                  <p className="text-sm text-neutral-500 mb-4">
                    Upload a CSV file with task locations. Format: <code>id,lon,lat</code>
                  </p>
                  <div className="flex gap-4 items-center">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => setTaskFile(e.target.files?.[0] || null)}
                      disabled={uploadingTasks}
                      className="flex-1 px-3 py-2 border border-neutral-300 rounded disabled:bg-neutral-50 disabled:cursor-not-allowed"
                    />
                    <button
                      onClick={handleUploadAnnotationTasks}
                      disabled={!taskFile || uploadingTasks}
                      className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {uploadingTasks && (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      )}
                      Upload
                    </button>
                  </div>
                </div>

                {/* Generate Tasks via Sampling */}
                <TaskGenerationSection
                  campaignId={numericCampaignId}
                  onTasksGenerated={handleTasksGenerated}
                  onError={(msg) => showAlert(msg, 'error')}
                />

                {/* Tasks Table */}
                <div className="bg-white rounded-lg border border-neutral-300 p-6">
                  <h2 className="text-lg font-semibold text-neutral-900 mb-4">
                    Annotation Tasks Overview
                  </h2>
                  {annotationTasks.length > 0 ? (
                    <AnnotationTasksTable
                      tasks={annotationTasks}
                      campaignUsers={campaignUsers}
                      onAssignTasks={handleAssignSingleTask}
                      onOpenBulkAssign={() => setShowAssignmentModal(true)}
                    />
                  ) : (
                    <p className="text-sm text-neutral-500">
                      No annotation tasks yet. Upload a CSV file or generate tasks using sampling
                      above.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'users' && (
            <>
              <CampaignUsersSection
                campaignId={numericCampaignId}
                onError={(msg) => {
                  showAlert(msg, 'error');
                }}
                onSuccess={(msg) => {
                  showAlert(msg, 'success');
                }}
              />
            </>
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
