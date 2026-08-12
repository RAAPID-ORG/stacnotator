import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { campaignPath } from '~/app/routes';
import { useCampaignBreadcrumbs } from '~/app/useCampaignBreadcrumbs';
import { useCampaignIdParam } from '~/shared/hooks/useCampaignIdParam';
import { useProjectIdParam } from '~/shared/hooks/useProjectIdParam';
import { useAccountStore } from '~/shared/stores/account.store';
import { createImageryView, type CampaignOutFull, type ImageryViewOut } from '~/api/client';
import { PopoutWindow } from '~/shared/ui/PopoutWindow';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { useIsMobile } from '~/shared/utils/useIsMobile';
import type { PolicyContext } from '~/features/annotation/core/annotation';
import { isAudienceMember } from '~/features/annotation/core/annotation';
import {
  buildCatalog,
  groupTimeseriesIntoWindows,
  isProxiedTileUrl,
} from '~/features/annotation/core/catalog';
import {
  loadCampaign,
  useImageryStore,
  useSessionStore,
  useWorkspaceStore,
  usePrefsStore,
  type LoadCampaignResult,
} from '~/features/annotation/stores';
import { ALL_TASK_STATUSES, type TaskFilter } from '~/features/annotation/core/tasks';
import {
  defaultWindowItem,
  fromGridLayout,
  mobileStack,
  toGridLayout,
} from '~/features/annotation/core/workspace';
import {
  Canvas,
  mergeLayoutChange,
  packItem,
  ScreenWindow,
  type LayoutItem,
  type PanelDef,
} from '~/features/annotation/engine/canvas';
import { setProxiedTileMatcher } from '~/features/annotation/engine/map';
import {
  activeFeatures,
  featuresToPanels,
  registerAllHotkeys,
  type ComposeCtx,
} from '~/features/annotation/composition';
import { EditOverlayControls } from '~/features/annotation/drawing';
import {
  EditControls,
  layoutWithoutPopped,
  RestoreScreensToast,
  SCREEN_DEFAULT_BOUNDS,
  SendToScreenButton,
  TrayContent,
  useScreens,
  ViewAdmin,
} from '~/features/annotation/chrome/layout-edit';
import { resetWindowSlices } from '~/features/annotation/panels/imagery-windows';
import { MAIN_MAP_PANEL_ID, resetMainMapNav } from '~/features/annotation/panels/main-map';
import { applyCameraTarget, loadCameraTarget } from '~/features/annotation/shared/cameras';
import { clearEditSession, openEdit } from '~/features/annotation/shared/editSession';
import { resetInteractionSpec } from '~/features/annotation/shared/interactionSpec';
import { resetToolState, selectTool } from '~/features/annotation/shared/toolState';
import { resetAnnotationVersion } from '~/features/annotation/shared/annotationVersion';
import { getMapFocus, setMapFocus } from '~/features/annotation/shared/mapFocus';
import { MobileSliceNav } from '~/features/annotation/chrome/mobile';
import {
  initTaskList,
  resetDigitBuffer,
  resetTaskList,
  setFilter,
  syncMapFocus,
  useTaskListState,
} from '~/features/annotation/panels/task-work';
import { Toolbar } from '~/features/annotation/chrome/toolbar';
import { TourOverlay } from '~/features/annotation/chrome/tour';
import {
  AllTasksDoneGate,
  LoadingGate,
  NoTasksGate,
  NoViewsGate,
  NotFoundGate,
  RegisteringGate,
} from './gates';

// The map engine must not know the shape of our backend tile-proxy routes;
// domain/catalog builds those URLs and is the authority on recognising them.
// Registered here because the page is where the app's parts are composed - the
// same seam the tiler-token refresher uses.
setProxiedTileMatcher(isProxiedTileUrl);

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; result: LoadCampaignResult };

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

function parseDeepLink(params: URLSearchParams | undefined): DeepLink {
  if (!params) return { isReviewMode: false };
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

/** Every panel needs a grid slot; a campaign that grew a time series (or a
 *  view that grew a window) since the layout was saved has panels the saved
 *  layout never heard of. Pack those in rather than dropping them. */
function ensureSlots(
  items: LayoutItem[],
  panelIds: string[],
  size: { w: number; h: number }
): LayoutItem[] {
  return panelIds.reduce((layout, id) => packItem(layout, id, size), items);
}

export function AnnotationPage() {
  const campaignId = useCampaignIdParam();
  const routeProjectId = useProjectIdParam();
  const currentUserId = useAccountStore((s) => s.account?.id ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const onDeepLinkConsumed = () => setSearchParams({}, { replace: true });
  const goTo = (subpage: 'settings' | 'tasks' | '') => () =>
    navigate(campaignPath(projectId, campaignId, subpage || undefined));
  const onNavigateSettings = goTo('settings');
  const onNavigateTasksPage = goTo('tasks');
  const onNavigateWorkPage = goTo('');

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  /** The campaign as edited on this page (view CRUD), seeded from the load. */
  const [campaign, setCampaign] = useState<CampaignOutFull | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskFilter | null>(null);

  const projectId = routeProjectId;
  useCampaignBreadcrumbs(projectId, campaignId, campaign?.name);
  const [bypassRegistering, setBypassRegistering] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [autoTourChecked, setAutoTourChecked] = useState(false);

  const isMobile = useIsMobile();
  const isFullscreen = useLayoutStore((s) => s.isFullscreen);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const workMode = useSessionStore((s) => s.workMode);
  const setWorkMode = useSessionStore((s) => s.setWorkMode);
  const selectedViewId = useSessionStore((s) => s.selectedViewId);
  const editing = useWorkspaceStore((s) => s.editing);
  const currentLayout = useWorkspaceStore((s) => s.currentLayout);
  const setLayout = useWorkspaceStore((s) => s.setLayout);
  const hideWindow = useWorkspaceStore((s) => s.hideWindow);
  const newWindowSize = useWorkspaceStore((s) => s.newWindowSize);
  const { visibleTasks, loaded: tasksLoaded, allTasks } = useTaskListState();

  const canvasRef = useRef<HTMLDivElement | null>(null);

  // ------------------------------------------------------------------
  // Campaign load
  // ------------------------------------------------------------------
  useEffect(() => {
    const link = parseDeepLink(searchParams);
    onDeepLinkConsumed?.();
    setBypassRegistering(false);
    setAutoTourChecked(false);
    setLoad({ status: 'loading' });

    let cancelled = false;
    void loadCampaign(campaignId, {
      now: Date.now(),
      currentUserId,
      isReviewMode: link.isReviewMode,
      initialWorkMode: link.workMode,
      initialTaskSetId: link.taskSetId,
      deepLinkAnnotationId: link.annotationId,
    })
      .then(async (result) => {
        if (cancelled) return;
        setLoad({ status: 'ready', result });
        setCampaign(result.campaign);
        setTaskFilter(result.taskFilter);
        initTaskList(
          result.tasks,
          result.taskSets,
          result.taskFilter,
          currentUserId,
          Date.now(),
          link.taskId
        );
        syncMapFocus(result.catalog);

        // Point the camera at what was just loaded. Nothing else does: the
        // cameras are module-scope singletons that outlive any one campaign,
        // so a page that never framed its own campaign opens on the whole
        // world. The ?lat/?lon deep link (the annotations page's "View" link)
        // is folded into the same decision - it too lands at the campaign's
        // working zoom, not at whatever the camera happened to be on.
        const seededMode = useSessionStore.getState().workMode;
        const address = useImageryStore.getState().address;
        applyCameraTarget(
          loadCameraTarget({
            mode: seededMode,
            taskCenter: getMapFocus()?.center ?? null,
            campaignBbox: result.catalog.bbox,
            workingZoom: address
              ? (result.catalog.sources.get(address.sourceId)?.default_zoom ?? null)
              : null,
            deepLinkCenter: link.center,
          })
        );

        if (result.deepLinkEditAnnotationId != null) {
          // loadCampaign only stages this id in Explore, so the mode here is
          // not an assumption - it is the same condition, read back.
          const ctx = {
            campaign: result.campaign,
            catalog: result.catalog,
            view: result.view,
            mode: seededMode,
            isMobile,
          };
          // Order matters: the drawing feature's hook clears the edit session
          // whenever the tool is not 'edit', so arming the tool first is what
          // keeps the deep-linked annotation open.
          await selectTool('edit', ctx);
          await openEdit(campaignId, result.deepLinkEditAnnotationId);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setLoad({ status: 'failed' });
        handleError(error, 'Failed to load campaign');
      });

    // Leaving a campaign clears everything scoped to it. The store surfaces
    // are re-seeded by loadCampaign itself; what is left here is the state the
    // features keep in module scope, which no store re-seeds and which would
    // otherwise leak into the next campaign - a probe marker on a place nobody
    // clicked, a slice pick made against another time series, a source-cycling
    // memory keyed by an id that means something else now, a held-down A/D
    // still stepping slices. This is the seam because the effect's dependency
    // list *is* campaign identity: React runs this cleanup before the new
    // load starts, so a campaign change can never be observed half-cleared.
    return () => {
      cancelled = true;
      resetTaskList();
      resetToolState();
      resetInteractionSpec();
      resetWindowSlices();
      resetMainMapNav();
      resetDigitBuffer();
      clearEditSession();
      resetAnnotationVersion();
      setMapFocus(null);
    };
    // A new campaign is a whole new page; nothing else re-runs the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, currentUserId]);

  // ------------------------------------------------------------------
  // Derived page context
  // ------------------------------------------------------------------
  const catalog = useMemo(() => (campaign ? buildCatalog(campaign) : null), [campaign]);
  const view: ImageryViewOut | null =
    campaign?.imagery_views.find((v) => v.id === selectedViewId) ??
    campaign?.imagery_views[0] ??
    null;

  const policy: PolicyContext = useMemo(
    () => ({
      userId: currentUserId,
      isAdmin: campaign?.viewer_is_admin ?? false,
      isAuthoritative: campaign?.viewer_is_authoritative_reviewer ?? false,
      isMember: campaign?.viewer_is_member ?? false,
    }),
    [currentUserId, campaign]
  );

  const ctx: ComposeCtx | null = useMemo(
    () => (campaign && catalog ? { campaign, catalog, view, mode: workMode, isMobile } : null),
    [campaign, catalog, view, workMode, isMobile]
  );

  const features = useMemo(() => (ctx ? activeFeatures(ctx) : []), [ctx]);

  useEffect(() => {
    if (!ctx) return;
    return registerAllHotkeys(features, ctx);
  }, [features, ctx]);

  // A deep link (?mode=explore) can seed a mode the campaign's labelling policy
  // does not allow this user. The toolbar switch is disabled for them, which
  // alone would strand them on a dead end - bounce to Tasks once tasks exist.
  useEffect(() => {
    if (!campaign || !tasksLoaded || workMode !== 'explore' || allTasks.length === 0) return;
    if (!isAudienceMember(campaign.settings.labelling_policy.explore, policy)) setWorkMode('tasks');
  }, [campaign, tasksLoaded, workMode, allTasks.length, policy, setWorkMode]);

  // Auto-open the tour the first time this user opens this campaign. In tasks
  // mode wait for a visible task, so the task steps have something to walk
  // through. Fires at most once per (user, campaign).
  // Both the tour's "seen" flag and the remembered screen split are scoped to
  // this user on this campaign.
  const scope = campaign && currentUserId ? `${currentUserId}:${campaign.id}` : null;
  useEffect(() => {
    if (!scope || autoTourChecked) return;
    if (workMode === 'tasks' && visibleTasks.length === 0) return;
    setAutoTourChecked(true);
    if (!usePrefsStore.getState().toursSeen.includes(scope)) setTourOpen(true);
  }, [scope, autoTourChecked, workMode, visibleTasks.length]);

  const closeTour = () => {
    setTourOpen(false);
    if (scope) usePrefsStore.getState().markTourSeen(scope);
  };

  const applyFilter = (next: TaskFilter) => {
    setTaskFilter(next);
    if (catalog) setFilter(next, Date.now(), catalog);
  };

  const showAllTasks = () => {
    if (taskFilter)
      applyFilter({ ...taskFilter, assignedTo: [], statuses: [...ALL_TASK_STATUSES] });
  };

  // The tour widens the filter for its duration; the filter it widened *from*
  // has to survive the widening, so it is held aside rather than read back off
  // state (which by then is the widened one).
  const filterBeforeTour = useRef<TaskFilter | null>(null);

  // ------------------------------------------------------------------
  // Canvas composition
  // ------------------------------------------------------------------
  // Screens are a desktop affordance; mobile keeps its fixed stacked layout.
  const screens = useScreens(isMobile ? null : scope);
  const showPopoutButtons = !isMobile && editing;

  // currentLayout is a real dependency: the imagery-windows feature composes a
  // panel per collection that has a window in the layout, so hiding or
  // re-adding one changes the panel set without changing ctx.
  const activeCollectionId = useImageryStore((s) => s.address?.collectionId);

  const basePanels = useMemo(
    () =>
      (ctx ? featuresToPanels(features, ctx) : []).map((panel) =>
        panel.id === String(activeCollectionId) ? { ...panel, className: 'active-window' } : panel
      ),
    [features, ctx, currentLayout, activeCollectionId]
  );

  const panels: PanelDef[] = useMemo(
    () =>
      basePanels.map((panel) =>
        // The main map is the one panel that cannot leave the main window: it
        // is the leader every other camera follows, and the page would be left
        // with no map at all, so it gets no send control.
        showPopoutButtons && panel.id !== MAIN_MAP_PANEL_ID
          ? {
              ...panel,
              header: (
                <>
                  {panel.header}
                  <SendToScreenButton
                    panelId={panel.id}
                    label={panel.title ?? panel.id}
                    screenIds={screens.state.screens.map((s) => s.id)}
                    onSend={(target) =>
                      screens.send(
                        panel.id,
                        target,
                        toGridLayout(useWorkspaceStore.getState().currentLayout).find(
                          (it) => it.i === panel.id
                        ),
                        canvasRef.current?.clientWidth ?? 0
                      )
                    }
                  />
                </>
              ),
            }
          : panel
      ),
    [basePanels, showPopoutButtons, screens]
  );

  const panelIds = useMemo(() => panels.map((p) => p.id), [panels]);
  const windowSize = defaultWindowItem(newWindowSize.perRow, newWindowSize.rows);

  const gridItems = useMemo(
    () => ensureSlots(toGridLayout(currentLayout), panelIds, windowSize),
    [currentLayout, panelIds, windowSize.w, windowSize.h] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const timeseriesKeys = useMemo(
    () => (campaign ? groupTimeseriesIntoWindows(campaign.time_series).map((w) => w.key) : []),
    [campaign]
  );

  // Mobile ignores the saved desktop grid for a single stacked column. Its half
  // rows are sized off the viewport rather than the canvas box: the canvas fills
  // what is left of the viewport anyway, and reading it back would need the grid
  // to be laid out before its own layout could be computed.
  const mobileLayout = useMemo(
    () =>
      isMobile ? mobileStack(currentLayout.view, timeseriesKeys, window.innerHeight) : undefined,
    [isMobile, currentLayout.view, timeseriesKeys]
  );

  // Sent-away panels keep their slot in the stored layout (that is where they
  // return to) but are withheld from the grid so it can use the space.
  const canvasLayout = layoutWithoutPopped(gridItems, screens.popped);

  const handleLayoutChange = (next: LayoutItem[]) => {
    const previous = toGridLayout(useWorkspaceStore.getState().currentLayout);
    setLayout(fromGridLayout(mergeLayoutChange(next, previous, screens.popped), currentLayout));
  };

  // A sent-away panel can disappear from under us (a view switch drops its
  // collection, settings drop a time series): return it to the main canvas.
  useEffect(() => {
    screens.pruneTo(new Set(panelIds));
  }, [panelIds, screens]);

  const panelsById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const screenPanels = (screenId: number): PanelDef[] =>
    Object.entries(screens.state.assignment)
      .filter(([, id]) => id === screenId)
      .flatMap(([panelId]) => {
        const panel = panelsById.get(panelId);
        if (!panel) return [];
        return [
          {
            ...panel,
            header: (
              <>
                {panel.header}
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    screens.returnPanel(panelId);
                  }}
                  title="Return to the main canvas"
                  data-testid={`return-${panelId}`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 hover:bg-neutral-100"
                >
                  Return
                </button>
              </>
            ),
          },
        ];
      });

  // ------------------------------------------------------------------
  // Gates
  // ------------------------------------------------------------------
  const isRegistering =
    campaign?.registration_status === 'registering' || campaign?.embedding_status === 'registering';

  if (load.status === 'loading') return <LoadingGate />;
  if (load.status === 'failed' || !campaign || !catalog || !ctx || !taskFilter)
    return <NotFoundGate />;

  if (isRegistering && !bypassRegistering) {
    return (
      <RegisteringGate
        campaign={campaign}
        isCampaignAdmin={policy.isAdmin}
        onBypass={() => setBypassRegistering(true)}
        onNavigateSettings={onNavigateSettings}
      />
    );
  }

  if (campaign.imagery_views.length === 0) {
    return (
      <NoViewsGate
        campaign={campaign}
        isCampaignAdmin={policy.isAdmin}
        onNavigateSettings={onNavigateSettings}
        onCreateFirstView={() => {
          void createImageryView({
            path: { campaign_id: campaign.id },
            body: { name: 'Default view', source_ids: campaign.imagery_sources.map((s) => s.id) },
          })
            .then((res) => {
              if (!res.data) return;
              setCampaign({ ...campaign, imagery_views: [res.data] });
              useSessionStore.getState().selectView(res.data.id, catalog, null);
              useWorkspaceStore.getState().startEditing();
            })
            .catch((error) => handleError(error, 'Could not create the view'));
        }}
      />
    );
  }

  const showCanvas = workMode === 'explore' || visibleTasks.length > 0;

  const layoutControls = (
    <EditControls campaign={campaign} view={view} isCampaignAdmin={policy.isAdmin} />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        campaign={campaign}
        catalog={catalog}
        tasks={allTasks}
        taskSets={load.result.taskSets}
        taskFilter={taskFilter}
        onTaskFilterChange={(patch) => applyFilter({ ...taskFilter, ...patch })}
        policy={policy}
        layoutControls={layoutControls}
        onNavigateWorkPage={onNavigateWorkPage}
        onNavigateSettings={onNavigateSettings}
        onOpenTour={() => setTourOpen(true)}
      />

      {showCanvas ? (
        <Canvas
          panels={panels}
          layout={canvasLayout}
          onLayoutChange={handleLayoutChange}
          editing={editing && !isMobile}
          onHidePanel={(id) => hideWindow(Number(id))}
          fullscreen={isFullscreen}
          outerRef={canvasRef}
          mobileLayout={mobileLayout}
        />
      ) : workMode === 'tasks' && !tasksLoaded ? (
        <LoadingGate text="Loading tasks..." />
      ) : allTasks.length === 0 ? (
        <NoTasksGate
          isCampaignAdmin={policy.isAdmin}
          onNavigateTasks={onNavigateTasksPage}
          onSwitchToExplore={() => setWorkMode('explore')}
        />
      ) : (
        <AllTasksDoneGate onShowAllTasks={showAllTasks} />
      )}

      {isMobile && <MobileSliceNav ctx={ctx} />}
      {!isMobile && <EditOverlayControls ctx={ctx} />}

      {!isMobile && editing && (
        <>
          <TrayContent catalog={catalog} view={view} canvasRef={canvasRef} />
          {policy.isAdmin && (
            <div className="fixed bottom-3 left-3 z-[1002] max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white/95 p-3 shadow-xl">
              <ViewAdmin campaign={campaign} onCampaignChange={setCampaign} />
            </div>
          )}
        </>
      )}

      {!isMobile &&
        screens.state.screens.map((screen) => (
          <ScreenWindow
            key={screen.id}
            screenId={screen.id}
            panels={screenPanels(screen.id)}
            layout={screen.layout}
            editing={editing}
            onLayoutChange={(l) => screens.setScreenLayout(screen.id, l)}
            onClose={() => screens.close(screen.id)}
            bounds={screen.bounds ?? SCREEN_DEFAULT_BOUNDS}
            onBounds={(b) => screens.rememberBounds(screen.id, b)}
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
          count={screens.restorable}
          onRestore={screens.restoreSaved}
          onDismiss={screens.dismissSaved}
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
        onClose={closeTour}
      />
    </div>
  );
}
