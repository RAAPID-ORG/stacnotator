import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '~/shared/ui/forms';
import { Skeleton, SkeletonForm } from '~/shared/ui/Skeleton';
import { LoadingOverlay } from '~/shared/ui/LoadingOverlay';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import TabNavigator from '~/shared/ui/TabNavigator';
import { DeleteCampaignDialog } from '~/features/campaigns/components/DeleteCampaignDialog';
import GeneralSettingsTab from '~/features/campaigns/components/settings/tabs/GeneralSettingsTab';
import ImageryTab from '~/features/campaigns/components/settings/tabs/ImageryTab';
import { usePersistedController } from '~/features/campaigns/components/imagery/controller';
import { useUnsavedChangesGuard } from '~/shared/hooks/useUnsavedChangesGuard';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { campaignPath, projectPath } from '~/app/routes';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';
import TimeseriesTab from '~/features/campaigns/components/settings/tabs/TimeseriesTab';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { capitalizeFirst } from '~/shared/utils/utility';
import { FadeIn } from '~/shared/ui/motion';

import {
  type ImagerySourceOut,
  type ProjectUserOut,
  type TimeSeriesCreate,
  type TimeSeriesOut,
} from '~/api/client';
import {
  createTimeseriesForCampaignMutation,
  deleteCampaignMutation,
  deleteTimeseriesMutation,
  getProjectUsersOptions,
  listProjectCampaignsQueryKey,
  updateCampaignNameMutation,
} from '~/api/queries';
import { useCampaign, useRefreshCampaign } from '../hooks/campaignQueries';

const SETTINGS_TABS = ['general', 'imagery', 'timeseries'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

const isSettingsTab = (t: string | null): t is SettingsTab =>
  (SETTINGS_TABS as readonly string[]).includes(t ?? '');

const NO_IMAGERY: ImagerySourceOut[] = [];
const NO_TIMESERIES: TimeSeriesOut[] = [];
const NO_USERS: ProjectUserOut[] = [];

export const CampaignSettingsPage = () => {
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const navigate = useNavigate();

  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : 'general';
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Registration and embedding run in the background after creation, so this
  // page keeps re-asking until they settle.
  const { campaign, loading } = useCampaign(campaignId, { pollWhileRegistering: true });
  const refreshCampaign = useRefreshCampaign(campaignId);

  // Campaign wins over the URL param, which only stands in until it loads and
  // can be wrong outright on a hand-edited /projects/<id>/campaigns/... URL.
  const projectId = campaign?.project_id ?? routeProjectId;
  const imagery = campaign?.imagery_sources ?? NO_IMAGERY;
  const timeseries = campaign?.time_series ?? NO_TIMESERIES;

  const [campaignName, setCampaignName] = useState('');
  const [newTimeseries, setNewTimeseries] = useState<TimeSeriesCreate[]>([]);

  // Confirm dialog states
  const [deleteConfirm, setDeleteConfirm] = useState<{
    timeseriesId?: number;
  } | null>(null);
  const [showDeleteCampaignDialog, setShowDeleteCampaignDialog] = useState(false);
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

  const imageryController = usePersistedController({
    campaignId: campaignId,
    projectId,
    imagery,
    basemaps: campaign?.basemaps ?? [],
    campaignBbox,
    refetch: refreshCampaign,
  });

  // Warn if the user navigates away with unsaved imagery edits.
  useUnsavedChangesGuard(imageryController.isDirty, {
    title: 'Unsaved imagery changes',
    description: 'Your imagery edits have not been saved and will be lost. Leave without saving?',
  });

  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name, 'Settings');

  // The name is edited in place, so it needs a draft of its own - seeded when
  // the campaign arrives and re-seeded if the stored name moves under us.
  const savedName = campaign?.name;
  useEffect(() => {
    if (savedName !== undefined) setCampaignName(savedName);
  }, [savedName]);

  const isAnyRegistering =
    campaign?.registration_status === 'registering' || campaign?.embedding_status === 'registering';

  // Only the transition out of "registering" is worth announcing; the poll
  // itself lives in useCampaign.
  const wasRegistering = useRef(false);
  useEffect(() => {
    if (isAnyRegistering) {
      wasRegistering.current = true;
      return;
    }
    if (!wasRegistering.current || !campaign) return;
    wasRegistering.current = false;
    const failed =
      campaign.registration_status === 'failed' || campaign.embedding_status === 'failed';
    showAlert(
      failed
        ? 'Background setup completed with some errors. Check settings.'
        : 'Campaign setup completed successfully',
      failed ? 'warning' : 'success'
    );
  }, [isAnyRegistering, campaign, showAlert]);

  // The general tab's labelling access needs the project's member list for the
  // "selected members" picker.
  const campaignProjectId = campaign?.project_id;
  const { data: projectUsersData } = useQuery({
    ...getProjectUsersOptions({ path: { project_id: campaignProjectId ?? 0 } }),
    enabled: activeTab === 'general' && campaignProjectId !== undefined,
    meta: { errorMessage: 'Failed to load project members' },
  });
  const projectUsers = projectUsersData?.users ?? NO_USERS;

  const renameCampaign = useMutation({
    ...updateCampaignNameMutation(),
    meta: { errorMessage: 'Failed to save campaign name' },
    onSuccess: () => {
      void refreshCampaign();
      showAlert('Campaign name updated successfully', 'success');
    },
    onError: () => setCampaignName(campaign?.name ?? ''),
  });

  const removeCampaign = useMutation({
    ...deleteCampaignMutation(),
    meta: { errorMessage: 'Failed to delete campaign' },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: listProjectCampaignsQueryKey({ path: { project_id: projectId } }),
      });
      showAlert('Campaign deleted successfully', 'success');
      setShowDeleteCampaignDialog(false);
      navigate(projectPath(projectId));
    },
  });

  const removeTimeseries = useMutation({
    ...deleteTimeseriesMutation(),
    meta: { errorMessage: 'Failed to delete timeseries' },
    onSuccess: () => {
      void refreshCampaign();
      setDeleteConfirm(null);
      showAlert('Timeseries deleted successfully', 'success');
    },
  });

  const addTimeseries = useMutation({
    ...createTimeseriesForCampaignMutation(),
    meta: { errorMessage: 'Failed to add timeseries' },
    onSuccess: (result) => {
      void refreshCampaign();
      setNewTimeseries([]);
      showAlert(`${result.new_items.length} timeseries added successfully`, 'success');
    },
  });

  const saving =
    renameCampaign.isPending ||
    removeCampaign.isPending ||
    removeTimeseries.isPending ||
    addTimeseries.isPending;

  const handleSaveName = () => {
    if (!campaign || campaignName === campaign.name) return;
    renameCampaign.mutate({ path: { campaign_id: campaignId }, body: { name: campaignName } });
  };

  const handleDeleteTimeseries = () => {
    if (!deleteConfirm?.timeseriesId) return;
    removeTimeseries.mutate({
      path: { campaign_id: campaignId, timeseries_id: deleteConfirm.timeseriesId },
    });
  };

  const handleDeleteCampaign = () => removeCampaign.mutate({ path: { campaign_id: campaignId } });

  const handleAddTimeseries = () => {
    if (newTimeseries.length === 0) return;
    addTimeseries.mutate({
      path: { campaign_id: campaignId },
      body: {
        timeseries: newTimeseries.map((ts) => ({
          ...ts,
          start_ym: ts.start_ym ? ts.start_ym.replace(/-/g, '') : ts.start_ym,
          end_ym: ts.end_ym ? ts.end_ym.replace(/-/g, '') : ts.end_ym,
        })),
      },
    });
  };

  if (!loading && !campaign) return null;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <FadeIn className="page">
          <header className="page-header">
            <div>
              {campaign ? (
                <h1 className="page-title">{capitalizeFirst(campaign.name)}</h1>
              ) : (
                <Skeleton className="h-7 w-52" />
              )}
              <p className="page-subtitle">Manage your campaign settings and imagery.</p>
            </div>
            {campaign && (
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
                    onClick={() => navigate(campaignPath(projectId, campaignId, 'annotate'))}
                    disabled={isAnyRegistering}
                    title={
                      isAnyRegistering ? 'Waiting for background setup to complete...' : undefined
                    }
                  >
                    Start annotating
                  </Button>
                )}
              </div>
            )}
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

          {/* Static chrome (surface + tabs) renders immediately; only the tab
              content waits for the campaign fetch. */}
          <div className="surface">
            {/* Tab Navigation - inset into the top of the surface so the
                tabs read as the surface's header, not a separate strip. */}
            <TabNavigator<SettingsTab>
              items={[
                { id: 'general', label: 'General Settings' },
                { id: 'imagery', label: 'Imagery' },
                { id: 'timeseries', label: 'Timeseries' },
              ]}
              activeId={activeTab}
              onChange={setActiveTab}
              className="!mb-0 !border-neutral-200 px-6"
            />

            <div className="p-6">
              {!campaign ? (
                <SkeletonForm sections={3} />
              ) : (
                <>
                  {activeTab === 'general' && (
                    <GeneralSettingsTab
                      campaign={campaign}
                      campaignName={campaignName}
                      setCampaignName={setCampaignName}
                      saving={saving}
                      onSaveName={handleSaveName}
                      onOpenDelete={() => setShowDeleteCampaignDialog(true)}
                      projectUsers={projectUsers}
                    />
                  )}

                  {activeTab === 'imagery' && <ImageryTab controller={imageryController} />}

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
                      campaignMode={campaign.mode || 'tasks'}
                      campaignSettings={campaign.settings || {}}
                    />
                  )}
                </>
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
