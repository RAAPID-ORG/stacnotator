import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createImageryView, getCampaignWithImageryWindows } from '~/api/client';
import { ensureTilerSession } from '~/api/tilerToken';
import { campaignPath } from '~/app/routes';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { useAccountStore } from '~/shared/stores/account.store';
import { useLayoutStore as useAppLayoutStore } from '~/shared/stores/layout.store';
import { PopoutWindow } from '~/shared/ui/PopoutWindow';
import { handleError } from '~/shared/utils/errorHandler';
import { useIsMobile } from '~/shared/utils/useIsMobile';
import { allBindings, resetNavMemory } from './bindings';
import { Canvas } from './canvas/Canvas';
import { EditOverlayControls } from './chrome/EditOverlayControls';
import {
  AllTasksDoneGate,
  LoadingGate,
  NoTasksGate,
  NoViewsGate,
  NotFoundGate,
  RegisteringGate,
} from './chrome/Gates';
import { LayoutEditControls } from './canvas/LayoutEdit/LayoutEditControls';
import { TrayContent } from './canvas/LayoutEdit/TrayContent';
import { ViewAdmin } from './canvas/LayoutEdit/ViewAdmin';
import { MobileSliceNav } from './chrome/MobileSliceNav';
import { RestoreScreensToast, SendToScreenButton } from './canvas/Screens/ScreenControls';
import { ScreenWindow } from './canvas/Screens/ScreenWindow';
import { Toolbar } from './chrome/Toolbar/Toolbar';
import { TourOverlay } from './chrome/Tour/TourOverlay';
import { useHotkeys } from './hotkeys';
import { groupTimeseriesIntoWindows } from './campaign/catalog';
import { isAudienceMember } from './campaign/annotation';
import {
  coversPanels,
  defaultWindowItem,
  fromGridLayout,
  mergeLayoutChange,
  mobileStack,
  packItem,
  toGridLayout,
  withoutKeys,
  type LayoutItem,
} from './canvas/grid';
import { ALL_TASK_STATUSES, type TaskFilter } from './campaign/tasks';
import { applyCameraTarget, focusFirstViewSetup, loadCameraTarget } from './map/camera';
import { buildPanels, MAIN_MAP_PANEL, type PanelDef } from './panels/panels';
import { loadCampaign } from './loadCampaign';
import { usePolicy, useCampaignStore } from './stores/campaign';
import { useImageryStore } from './stores/imagery';
import {
  SCREEN_DEFAULT_BOUNDS,
  useLayoutStore,
  usePoppedPanels,
  useRestorableScreens,
} from './stores/layout';
import { usePrefsStore } from './stores/prefs';
import { useTasksStore } from './stores/tasks';
import { useWorkStore } from './stores/work';

type LoadState = 'loading' | 'ready' | 'failed';

interface DeepLink {
  taskId?: number;
  taskSetId?: number;
  workMode?: 'tasks' | 'explore';
  isReviewMode: boolean;
  annotationId?: number;
  center?: [number, number];
}

/** Number(null) is 0, so every numeric parameter needs the presence check. */
function numberParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseDeepLink(params: URLSearchParams): DeepLink {
  const mode = params.get('mode');
  const lat = numberParam(params, 'lat');
  const lon = numberParam(params, 'lon');
  return {
    taskId: numberParam(params, 'task'),
    taskSetId: numberParam(params, 'taskSet'),
    workMode: mode === 'tasks' || mode === 'explore' ? mode : undefined,
    isReviewMode: params.get('review') === 'true',
    annotationId: numberParam(params, 'annotation'),
    center: lat !== undefined && lon !== undefined ? [lon, lat] : undefined,
  };
}

export function AnnotationPage() {
  const campaignId = useCampaignIdParam();
  const projectId = useProjectIdParam();
  const currentUserId = useAccountStore((s) => s.account?.id ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [load, setLoad] = useState<LoadState>('loading');
  const [bypassRegistering, setBypassRegistering] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [autoTourChecked, setAutoTourChecked] = useState(false);
  const [settingUpFirstView, setSettingUpFirstView] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const campaign = useCampaignStore((s) => s.campaign);
  const catalog = useCampaignStore((s) => s.catalog);
  const view = useCampaignStore((s) => s.view);
  const workMode = useCampaignStore((s) => s.workMode);
  const setWorkMode = useCampaignStore((s) => s.setWorkMode);
  const policy = usePolicy();

  const isFullscreen = useAppLayoutStore((s) => s.isFullscreen);
  const showAlert = useAppLayoutStore((s) => s.showAlert);
  const editing = useLayoutStore((s) => s.editing);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const newWindowSize = useLayoutStore((s) => s.newWindowSize);
  const screens = useLayoutStore((s) => s.screens);
  const popped = usePoppedPanels();
  const restorableScreens = useRestorableScreens();

  const visibleTasks = useTasksStore((s) => s.visibleTasks);
  const tasksLoaded = useTasksStore((s) => s.loaded);
  const allTasks = useTasksStore((s) => s.allTasks);
  const taskFilter = useTasksStore((s) => s.filter);

  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name);
  useEffect(() => useCampaignStore.getState().setMobile(isMobile), [isMobile]);

  const goTo = (subpage: 'settings' | 'tasks' | '') => () =>
    navigate(campaignPath(projectId, campaignId, subpage || undefined));

  // ------------------------------------------------------------------
  // Load
  // ------------------------------------------------------------------
  useEffect(() => {
    const link = parseDeepLink(searchParams);
    setSearchParams({}, { replace: true });
    setBypassRegistering(false);
    setAutoTourChecked(false);
    setSettingUpFirstView(false);
    setLoad('loading');
    // Tiles this campaign serves through our own tiler are cookie-authorized,
    // and the cookie is scoped to the campaign.
    void ensureTilerSession(String(campaignId));

    let cancelled = false;
    void loadCampaign(campaignId, {
      now: Date.now(),
      currentUserId,
      isReviewMode: link.isReviewMode,
      workMode: link.workMode,
      taskSetId: link.taskSetId,
      preferTaskId: link.taskId,
      annotationId: link.annotationId,
    })
      .then(async ({ annotationId }) => {
        if (cancelled) return;
        setLoad('ready');

        // Point the camera at what was just loaded. Nothing else does: the
        // cameras outlive any one campaign, so a page that never framed its own
        // would open on the whole world.
        const { catalog: cat, workMode: mode } = useCampaignStore.getState();
        const address = useImageryStore.getState().address;
        applyCameraTarget(
          loadCameraTarget({
            mode,
            taskCenter: useTasksStore.getState().focus?.center ?? null,
            campaignBbox: cat?.bbox ?? null,
            workingZoom: address
              ? (cat?.sources.get(address.sourceId)?.default_zoom ?? null)
              : null,
            deepLinkCenter: link.center,
          })
        );

        if (annotationId != null) {
          // Order matters: leaving the edit tool clears the session, so the
          // tool has to be armed before the annotation is opened.
          await useWorkStore.getState().selectTool('edit');
          await useWorkStore.getState().openEdit(annotationId);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setLoad('failed');
        handleError(error, 'Failed to load campaign');
      });

    // Leaving a campaign clears everything scoped to it. The stores are
    // re-seeded by the next load; what is left here is the state that lives
    // outside them - a held-down A/D still stepping slices, a half-typed label
    // number - which no load would reset.
    return () => {
      cancelled = true;
      useTasksStore.getState().reset();
      useWorkStore.getState().resetAll();
      useAppLayoutStore.getState().cancelConfirmDialog();
      resetNavMemory();
    };
    // A new campaign is a whole new page; nothing else re-runs the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, currentUserId]);

  // ------------------------------------------------------------------
  // Hotkeys
  // ------------------------------------------------------------------
  // allBindings() reads the stores directly, so the deps are what should
  // rebuild the table rather than what the closure literally names.
  const bindings = useMemo(
    () => (campaign && catalog ? allBindings() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign, catalog, view, workMode, isMobile]
  );
  useHotkeys(bindings, [bindings]);

  // A deep link can seed a mode the campaign's policy does not allow this
  // user. The toolbar switch is disabled for them, which alone would strand
  // them on a dead end - bounce to Tasks once tasks exist.
  useEffect(() => {
    if (!campaign || !tasksLoaded || workMode !== 'explore' || allTasks.length === 0) return;
    if (!isAudienceMember(campaign.settings.labelling_policy.explore, policy)) setWorkMode('tasks');
  }, [campaign, tasksLoaded, workMode, allTasks.length, policy, setWorkMode]);

  // ------------------------------------------------------------------
  // Tour
  // ------------------------------------------------------------------
  // Both the "seen" flag and the remembered screen split are scoped to this
  // user on this campaign.
  const scope = campaign && currentUserId ? `${currentUserId}:${campaign.id}` : null;
  useEffect(() => {
    useLayoutStore.getState().setScope(isMobile ? null : scope);
  }, [scope, isMobile]);

  useEffect(() => {
    if (!scope || autoTourChecked) return;
    // A campaign with no views is still in its layout-authoring flow. Count the
    // tour as checked for this visit so creating the first view does not put a
    // tour on top of the admin's edit canvas; it is offered on a later visit.
    if (campaign?.imagery_views.length === 0) {
      setAutoTourChecked(true);
      return;
    }
    // In tasks mode wait for a visible task, so the task steps have something
    // to walk through.
    if (workMode === 'tasks' && visibleTasks.length === 0) return;
    setAutoTourChecked(true);
    if (!usePrefsStore.getState().toursSeen.includes(scope)) setTourOpen(true);
  }, [scope, autoTourChecked, campaign?.imagery_views.length, workMode, visibleTasks.length]);

  const applyFilter = (next: TaskFilter) => {
    if (catalog) useTasksStore.getState().setFilter(next, Date.now(), catalog);
  };
  const showAllTasks = () =>
    applyFilter({ ...taskFilter, assignedTo: [], statuses: [...ALL_TASK_STATUSES] });

  // The tour widens the filter for its duration; the filter it widened *from*
  // has to survive that, so it is held aside rather than read back off state.
  const filterBeforeTour = useRef<TaskFilter | null>(null);

  // ------------------------------------------------------------------
  // Canvas
  // ------------------------------------------------------------------
  const panels: PanelDef[] = useMemo(() => {
    if (!campaign || !catalog) return [];
    const built = buildPanels({ campaign, catalog, view, mode: workMode, layout: currentLayout });
    // The main map is the leader every other camera follows and the page would
    // be left with no map at all, so it gets no send control.
    if (isMobile || !editing) return built;
    return built.map((panel) =>
      panel.id === MAIN_MAP_PANEL
        ? panel
        : {
            ...panel,
            header: (
              <>
                {panel.header}
                <SendToScreenButton
                  panelId={panel.id}
                  label={panel.title ?? panel.id}
                  screenIds={screens.screens.map((s) => s.id)}
                  onSend={(target) =>
                    useLayoutStore.getState().sendToScreen(
                      panel.id,
                      target,
                      toGridLayout(useLayoutStore.getState().currentLayout).find(
                        (it) => it.i === panel.id
                      ),
                      canvasRef.current?.clientWidth ?? 0
                    )
                  }
                />
              </>
            ),
          }
    );
  }, [campaign, catalog, view, workMode, currentLayout, isMobile, editing, screens]);

  const panelIds = useMemo(() => panels.map((p) => p.id), [panels]);
  const windowSize = defaultWindowItem(newWindowSize.perRow, newWindowSize.rows);

  // Every panel needs a grid slot; a campaign that grew a time series (or a
  // view that grew a window) since the layout was saved has panels the saved
  // layout never heard of. Pack those in rather than dropping them.
  const gridItems = useMemo(
    () =>
      panelIds.reduce((items, id) => packItem(items, id, windowSize), toGridLayout(currentLayout)),
    [currentLayout, panelIds, windowSize.w, windowSize.h] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Mobile ignores the saved desktop grid for a single stacked column. Its half
  // rows are sized off the viewport rather than the canvas box, which would
  // need the grid laid out before its own layout could be computed.
  const mobileLayout = useMemo(() => {
    if (!isMobile || !campaign) return undefined;
    const keys = groupTimeseriesIntoWindows(campaign.time_series).map((w) => w.key);
    return mobileStack(currentLayout.windows, keys, window.innerHeight);
  }, [isMobile, campaign, currentLayout.windows]);

  // A sent-away panel keeps its slot in the stored layout (that is where it
  // returns to) but is withheld from the grid so it can use the space.
  const canvasLayout = withoutKeys(gridItems, popped);
  const canvasPanelIds = panelIds.filter((id) => !popped.has(id));

  const handleLayoutChange = (next: LayoutItem[]) => {
    if (!coversPanels(next, canvasPanelIds)) return;
    const layout = useLayoutStore.getState();
    const previous = toGridLayout(layout.currentLayout);
    layout.setLayout(fromGridLayout(mergeLayoutChange(next, previous, popped), currentLayout));
  };

  // A sent-away panel can disappear from under us (a view switch drops its
  // collection, settings drop a time series): return it to the main canvas.
  useEffect(() => {
    useLayoutStore.getState().pruneScreensTo(new Set(panelIds));
  }, [panelIds]);

  const panelsById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const screenPanels = (screenId: number): PanelDef[] =>
    Object.entries(screens.assignment)
      .filter(([, id]) => id === screenId)
      .flatMap(([panelId]) => panelsById.get(panelId) ?? []);

  // ------------------------------------------------------------------
  // Registration polling
  // ------------------------------------------------------------------
  const isRegistering =
    campaign?.registration_status === 'registering' || campaign?.embedding_status === 'registering';

  // Campaign creation returns before mosaic registration finishes. Poll the
  // same response the initial load used so completed tile URLs appear without
  // the user having to refresh or wonder whether setup is stuck.
  useEffect(() => {
    if (!isRegistering) return;
    let cancelled = false;
    const interval = window.setInterval(() => {
      void getCampaignWithImageryWindows({ path: { campaign_id: campaignId } })
        .then(({ data }) => {
          if (!cancelled && data) useCampaignStore.getState().setCampaign(data);
        })
        .catch(() => {
          // Keep the visible status and retry; a transient polling failure
          // should not replace the workspace with an error state.
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [campaignId, isRegistering]);

  // ------------------------------------------------------------------
  // Gates
  // ------------------------------------------------------------------
  if (load === 'loading') return <LoadingGate />;
  if (load === 'failed' || !campaign || !catalog) return <NotFoundGate />;

  if (isRegistering && !bypassRegistering) {
    return (
      <RegisteringGate
        campaign={campaign}
        isCampaignAdmin={policy.isAdmin}
        onBypass={() => setBypassRegistering(true)}
        onNavigateSettings={goTo('settings')}
      />
    );
  }

  if (campaign.imagery_views.length === 0) {
    return (
      <NoViewsGate
        campaign={campaign}
        isCampaignAdmin={policy.isAdmin}
        onNavigateSettings={goTo('settings')}
        onCreateFirstView={() => {
          void createImageryView({
            path: { campaign_id: campaign.id },
            body: { name: 'Default view', source_ids: campaign.imagery_sources.map((s) => s.id) },
          })
            .then((res) => {
              if (!res.data) return;
              setSettingUpFirstView(true);
              useCampaignStore.getState().setCampaign({ ...campaign, imagery_views: [res.data] });
              useCampaignStore.getState().selectView(res.data);
              focusFirstViewSetup(campaign.imagery_sources[0]?.default_zoom ?? null);
              useLayoutStore.getState().startEditing();
            })
            .catch((error) => handleError(error, 'Could not create the view'));
        }}
      />
    );
  }

  const showCanvas = workMode === 'explore' || visibleTasks.length > 0;

  return (
    <div className="annotation-workspace flex min-h-0 flex-1 flex-col">
      <Toolbar
        campaign={campaign}
        tasks={allTasks}
        taskSets={useTasksStore.getState().taskSets}
        taskFilter={taskFilter}
        onTaskFilterChange={(patch) => applyFilter({ ...taskFilter, ...patch })}
        policy={policy}
        layoutControls={
          <LayoutEditControls
            campaign={campaign}
            view={view}
            isCampaignAdmin={policy.isAdmin}
            mustSaveDefault={settingUpFirstView}
            onDefaultSaved={() => setSettingUpFirstView(false)}
          />
        }
        onNavigateWorkPage={goTo('')}
        onNavigateSettings={goTo('settings')}
        onOpenTour={() => setTourOpen(true)}
      />

      {isRegistering && (
        <div
          className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-center text-sm text-blue-800"
          data-testid="registration-banner"
        >
          Preparing mosaic imagery in the background. You can arrange the layout now; imagery will
          appear automatically when registration finishes.
        </div>
      )}

      {showCanvas ? (
        <Canvas
          panels={panels}
          layout={canvasLayout}
          onLayoutChange={handleLayoutChange}
          editing={editing && !isMobile}
          onHidePanel={(id) => useLayoutStore.getState().hideWindow(Number(id))}
          fullscreen={isFullscreen}
          outerRef={canvasRef}
          mobileLayout={mobileLayout}
        />
      ) : workMode === 'tasks' && !tasksLoaded ? (
        <LoadingGate text="Loading tasks..." />
      ) : allTasks.length === 0 ? (
        <NoTasksGate
          isCampaignAdmin={policy.isAdmin}
          onNavigateTasks={goTo('tasks')}
          onSwitchToExplore={() => setWorkMode('explore')}
        />
      ) : (
        <AllTasksDoneGate onShowAllTasks={showAllTasks} />
      )}

      {isMobile ? <MobileSliceNav /> : <EditOverlayControls />}

      {!isMobile && editing && (
        <>
          <TrayContent catalog={catalog} view={view} canvasRef={canvasRef} />
          {policy.isAdmin && (
            <div className="fixed bottom-3 left-3 z-[1002] max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white/95 p-3 shadow-xl">
              <ViewAdmin />
            </div>
          )}
        </>
      )}

      {!isMobile &&
        screens.screens.map((screen) => (
          <ScreenWindow
            key={screen.id}
            screenId={screen.id}
            panels={screenPanels(screen.id)}
            layout={screen.layout}
            editing={editing}
            onLayoutChange={(l) => useLayoutStore.getState().setScreenLayout(screen.id, l)}
            onClose={() => useLayoutStore.getState().closeScreen(screen.id)}
            bounds={screen.bounds ?? SCREEN_DEFAULT_BOUNDS}
            onBounds={(b) => useLayoutStore.getState().rememberScreenBounds(screen.id, b)}
            onBlocked={() =>
              showAlert(
                'The browser blocked the new screen. Allow popups for this site and try again.',
                'error'
              )
            }
            windowComponent={PopoutWindow}
          />
        ))}

      {!isMobile && !editing && (
        <RestoreScreensToast
          count={restorableScreens}
          onRestore={() => useLayoutStore.getState().restoreSavedScreens()}
          onDismiss={() => useLayoutStore.getState().dismissSavedScreens()}
        />
      )}

      <TourOverlay
        open={tourOpen}
        variant={workMode}
        hasTimeseries={campaign.time_series.length > 0}
        needsBroaderFilter={workMode === 'tasks' && visibleTasks.length === 0}
        onBroadenFilter={() => {
          filterBeforeTour.current = taskFilter;
          showAllTasks();
        }}
        onRestoreFilter={() => {
          if (filterBeforeTour.current) applyFilter(filterBeforeTour.current);
          filterBeforeTour.current = null;
        }}
        onClose={() => {
          setTourOpen(false);
          if (scope) usePrefsStore.getState().markTourSeen(scope);
        }}
      />
    </div>
  );
}
