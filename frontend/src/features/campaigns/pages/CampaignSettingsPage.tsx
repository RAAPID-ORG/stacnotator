import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '~/shared/ui/forms';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { LoadingOverlay } from '~/shared/ui/LoadingOverlay';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import TabNavigator from '~/shared/ui/TabNavigator';
import { DeleteCampaignDialog } from '~/features/campaigns/components/DeleteCampaignDialog';
import GeneralSettingsTab from '~/features/campaigns/components/settings/tabs/GeneralSettingsTab';
import ImageryTab from '~/features/campaigns/components/settings/tabs/ImageryTab';
import { usePersistedController } from '~/features/campaigns/components/imagery/controller';
import { useUnsavedChangesGuard } from '~/shared/hooks/useUnsavedChangesGuard';
import { useCampaignIdParam } from '~/features/campaigns/hooks/useCampaignIdParam';
import TimeseriesTab from '~/features/campaigns/components/settings/tabs/TimeseriesTab';
import UsersTab from '~/features/campaigns/components/settings/tabs/UsersTab';
import { ImportFeaturesSection } from '~/features/campaigns/components/settings/ImportFeaturesSection';
import { useLayoutStore } from '~/features/layout/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { handleError } from '~/shared/utils/errorHandler';
import { FadeIn } from '~/shared/ui/motion';

import {
  createTimeseriesForCampaign,
  getCampaign,
  getCampaignUsers,
  deleteCampaign,
  deleteTimeseries,
  type CampaignOut,
  type CampaignUserOut,
  type ImagerySourceOut,
  type TimeSeriesCreate,
  type TimeSeriesOut,
  updateCampaignName,
  updateCampaignBbox,
} from '~/api/client';

const SETTINGS_TABS = ['general', 'imagery', 'users', 'timeseries', 'annotations'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

const isSettingsTab = (t: string | null): t is SettingsTab =>
  (SETTINGS_TABS as readonly string[]).includes(t ?? '');

export const CampaignSettingsPage = () => {
  const campaignId = useCampaignIdParam();
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState<CampaignOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : 'general';
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Form states
  const [campaignName, setCampaignName] = useState('');
  const [imagery, setImagery] = useState<ImagerySourceOut[]>([]);
  const [campaignUsers, setCampaignUsers] = useState<CampaignUserOut[]>([]);
  const [timeseries, setTimeseries] = useState<TimeSeriesOut[]>([]);
  const [newTimeseries, setNewTimeseries] = useState<TimeSeriesCreate[]>([]);

  // Confirm dialog states
  const [deleteConfirm, setDeleteConfirm] = useState<{
    timeseriesId?: number;
  } | null>(null);
  const [showDeleteCampaignDialog, setShowDeleteCampaignDialog] = useState(false);

  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);
  const showAlert = useLayoutStore((state) => state.showAlert);

  const campaignBbox = useMemo(
    () =>
      campaign?.settings
        ? [
            campaign.settings.bbox_west,
            campaign.settings.bbox_south,
            campaign.settings.bbox_east,
            campaign.settings.bbox_north,
          ]
        : null,
    [campaign?.settings]
  );

  // Refetch the campaign after imagery edits are persisted so local state
  // reflects server truth (and the controller clears its dirty flag).
  const handleImageryChanged = useCallback(async () => {
    try {
      const { data } = await getCampaign({ path: { campaign_id: campaignId } });
      if (data) {
        setCampaign(data);
        setImagery(data.imagery_sources);
      }
    } catch {
      /* silent refresh */
    }
  }, [campaignId]);

  const imageryController = usePersistedController({
    campaignId: campaignId,
    imagery,
    views: campaign?.imagery_views ?? [],
    basemaps: campaign?.basemaps ?? [],
    campaignBbox,
    refetch: handleImageryChanged,
  });

  // Warn if the user navigates away with unsaved imagery edits.
  useUnsavedChangesGuard(imageryController.isDirty, {
    title: 'Unsaved imagery changes',
    description: 'Your imagery edits have not been saved and will be lost. Leave without saving?',
  });

  useEffect(() => {
    if (campaign) {
      setBreadcrumbs([
        { label: 'Campaigns', path: '/campaigns' },
        { label: capitalizeFirst(campaign.name), path: `/campaigns/${campaign.id}` },
        { label: 'Settings' },
      ]);
    }
  }, [campaign, setBreadcrumbs]);

  // Task management moved to its own page - honor old ?tab=tasks deep links
  // (e.g. bookmarks, the annotator empty-state CTA) by forwarding them.
  useEffect(() => {
    if (tabParam === 'tasks') {
      navigate(`/campaigns/${campaignId}/tasks`, { replace: true });
    }
  }, [tabParam, campaignId, navigate]);

  // Load campaign data (core data only)
  useEffect(() => {
    const loadCampaign = async () => {
      try {
        setLoading(true);
        const { data } = await getCampaign({ path: { campaign_id: campaignId } });
        setCampaign(data!);
        setCampaignName(data!.name);
        setImagery(data!.imagery_sources);
        setTimeseries(data!.time_series);
      } catch (err) {
        handleError(err, 'Failed to load campaign');
      } finally {
        setLoading(false);
      }
    };

    loadCampaign();
  }, [campaignId]);

  // Poll while any background work is in progress
  const isAnyRegistering =
    campaign?.registration_status === 'registering' || campaign?.embedding_status === 'registering';

  useEffect(() => {
    if (!campaign || !isAnyRegistering) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await getCampaign({ path: { campaign_id: campaignId } });
        if (data) {
          setCampaign(data);
          setImagery(data.imagery_sources);
          const stillRegistering =
            data.registration_status === 'registering' || data.embedding_status === 'registering';
          if (!stillRegistering) {
            clearInterval(interval);
            const hasFailed =
              data.registration_status === 'failed' || data.embedding_status === 'failed';
            showAlert(
              hasFailed
                ? 'Background setup completed with some errors. Check settings.'
                : 'Campaign setup completed successfully',
              hasFailed ? 'warning' : 'success'
            );
          }
        }
      } catch {
        /* silent poll */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isAnyRegistering, campaignId, showAlert]);

  // Load campaign users when the users tab is active. Re-fetches every time
  // the tab becomes active so changes made there (add / remove / promote)
  // stay current.
  useEffect(() => {
    if (activeTab !== 'users') return;

    const loadUsers = async () => {
      try {
        const { data } = await getCampaignUsers({
          path: { campaign_id: campaignId },
        });
        setCampaignUsers(data!.users);
      } catch (err) {
        handleError(err, 'Failed to load campaign users');
      }
    };

    loadUsers();
  }, [activeTab, campaignId]);

  const handleSaveName = async () => {
    if (!campaign || campaignName === campaign.name) return;
    try {
      setSaving(true);
      await updateCampaignName({
        path: { campaign_id: campaignId },
        body: { name: campaignName },
      });

      // Update local state immediately
      setCampaign({ ...campaign, name: campaignName });

      showAlert('Campaign name updated successfully', 'success');
    } catch (err) {
      handleError(err, 'Failed to save campaign name');
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
        path: { campaign_id: campaignId },
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
      handleError(err, 'Failed to save settings');

      // Reload campaign to revert changes on error
      try {
        const { data } = await getCampaign({ path: { campaign_id: campaignId } });
        setCampaign(data!);
      } catch (reloadErr) {
        handleError(reloadErr, 'Failed to reload campaign after error', { showUser: false });
      }
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
          campaign_id: campaignId,
          timeseries_id: deleteConfirm.timeseriesId,
        },
      });

      // Update local state immediately
      setTimeseries(timeseries.filter((ts) => ts.id !== deleteConfirm.timeseriesId));
      setDeleteConfirm(null);
      showAlert('Timeseries deleted successfully', 'success');
    } catch (err) {
      handleError(err, 'Failed to delete timeseries');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCampaign = async () => {
    if (!campaign) return;

    try {
      setSaving(true);

      await deleteCampaign({
        path: { campaign_id: campaignId },
      });

      showAlert('Campaign deleted successfully', 'success');
      setShowDeleteCampaignDialog(false);

      // Navigate to campaigns list after successful deletion
      navigate('/campaigns');
    } catch (err) {
      handleError(err, 'Failed to delete campaign');
    } finally {
      setSaving(false);
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
        path: { campaign_id: campaignId },
        body: timeseriesToCreate,
      });
      setTimeseries([...timeseries, ...data!.new_items]);
      setNewTimeseries([]);
      showAlert(`${data!.new_items.length} timeseries added successfully`, 'success');
    } catch (err) {
      handleError(err, 'Failed to add timeseries');
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
        <FadeIn className="page">
          <header className="page-header">
            <div>
              <h1 className="page-title">{capitalizeFirst(campaign.name)}</h1>
              <p className="page-subtitle">Manage your campaign settings, imagery, and users.</p>
            </div>
            <div className="flex gap-2">
              {imageryController.isDirty ? (
                <Button
                  onClick={() => {
                    imageryController.save().catch(() => {
                      /* error already surfaced via handleError */
                    });
                  }}
                  disabled={imageryController.pending}
                >
                  {imageryController.pending ? 'Saving…' : 'Save'}
                </Button>
              ) : (
                <Button
                  onClick={() => navigate(`/campaigns/${campaignId}/annotate`)}
                  disabled={isAnyRegistering}
                  title={
                    isAnyRegistering ? 'Waiting for background setup to complete...' : undefined
                  }
                >
                  Start annotating
                </Button>
              )}
            </div>
          </header>

          {/* Background setup status banners - sit above the surface so they
              read as "page-level alerts", not as part of the form content. */}
          <div className="space-y-3 mb-4 empty:hidden">
            {campaign?.registration_status === 'registering' && (
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                <svg
                  className="animate-spin h-4 w-4 text-blue-600 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                >
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
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span>
                  <strong>Mosaic registration in progress...</strong> Tile imagery is being
                  registered from the STAC catalog.
                </span>
              </div>
            )}
            {campaign?.embedding_status === 'registering' && (
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                <svg
                  className="animate-spin h-4 w-4 text-blue-600 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                >
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
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span>
                  <strong>Embedding generation in progress...</strong> Satellite embeddings are
                  being computed for the campaign area. You can configure other settings while
                  waiting.
                </span>
              </div>
            )}
            {campaign?.registration_status === 'failed' && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 space-y-2">
                <p>
                  <strong>Some mosaic registrations failed.</strong> The campaign is usable but some
                  tiles may be missing. Check the Imagery tab to re-register individual collections.
                </p>
                {campaign.registration_errors && campaign.registration_errors.length > 0 && (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer font-medium text-red-700 hover:text-red-900">
                      Show {campaign.registration_errors.length} error
                      {campaign.registration_errors.length !== 1 ? 's' : ''}
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3 list-disc text-red-700">
                      {campaign.registration_errors.slice(0, 20).map((rawErr, i) => {
                        const err = rawErr as {
                          collection?: string;
                          slice?: string;
                          error?: string;
                        };
                        return (
                          <li key={i}>
                            {err.collection && (
                              <span className="font-medium">{err.collection}</span>
                            )}
                            {err.slice && <span> / {err.slice}</span>}
                            {(err.collection || err.slice) && ': '}
                            {err.error}
                          </li>
                        );
                      })}
                      {campaign.registration_errors.length > 20 && (
                        <li className="text-red-500">
                          ...and {campaign.registration_errors.length - 20} more
                        </li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {campaign?.embedding_status === 'failed' && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                <p>
                  <strong>Embedding generation failed.</strong> The campaign is usable but
                  embedding-based features (similarity search) won&apos;t be available.
                </p>
                {campaign.registration_errors?.some((e) =>
                  (e as { error?: string }).error?.startsWith('Embeddings:')
                ) && (
                  <p className="text-[11px] mt-1 text-red-700">
                    {
                      (
                        campaign.registration_errors.find((e) =>
                          (e as { error?: string }).error?.startsWith('Embeddings:')
                        ) as { error?: string }
                      )?.error
                    }
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="surface">
            {/* Tab Navigation - inset into the top of the surface so the
                tabs read as the surface's header, not a separate strip. */}
            <TabNavigator<SettingsTab>
              items={[
                { id: 'general', label: 'General Settings' },
                { id: 'imagery', label: 'Imagery' },
                { id: 'timeseries', label: 'Timeseries' },
                { id: 'annotations', label: 'Annotations' },
                { id: 'users', label: 'Users' },
              ]}
              activeId={activeTab}
              onChange={setActiveTab}
              className="!mb-0 !border-neutral-200 px-6"
            />

            <div className="p-6">
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
                  onCampaignUpdated={(updated) => setCampaign(updated)}
                />
              )}

              {activeTab === 'imagery' && (
                <ImageryTab controller={imageryController} campaignBbox={campaignBbox} />
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

              {activeTab === 'annotations' && (
                <ImportFeaturesSection
                  campaignId={campaignId}
                  labels={campaign!.settings.labels}
                  onSuccess={(msg) => showAlert(msg, 'success')}
                  onError={(msg) => showAlert(msg, 'error')}
                />
              )}

              {activeTab === 'users' && (
                <UsersTab
                  campaignId={campaignId}
                  onError={(msg) => showAlert(msg, 'error')}
                  onSuccess={(msg) => showAlert(msg, 'success')}
                  campaignUsers={campaignUsers}
                />
              )}
            </div>
          </div>
        </FadeIn>
      </div>

      {/* Global Modals */}
      <LoadingOverlay visible={saving && !deleteConfirm} text="Saving..." />

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        title="Delete Timeseries?"
        description="This action cannot be undone. The timeseries will be permanently removed from the campaign."
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
        isLoading={saving}
        onConfirm={handleDeleteTimeseries}
        onCancel={() => setDeleteConfirm(null)}
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
