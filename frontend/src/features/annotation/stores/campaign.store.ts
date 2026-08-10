import { create } from 'zustand';
import type { Layout } from 'react-grid-layout';
import {
  getCampaignWithImageryWindows,
  getAllAnnotationTasks,
  listTaskSets,
  createNewCanvasLayout,
  createImageryView,
  updateImageryView,
  reorderImageryViews,
  deleteImageryView,
  getKnnValidationStatus,
  type CampaignOutFull,
  type ImageryViewOut,
  type KnnValidationStatusOut,
} from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { useMapStore } from './map.store';
import { useTaskStore } from './task.store';
import { useAnnotationStore } from './annotation.store';
import { usePreferencesStore } from './preferences.store';
import { DEFAULT_MAP_ZOOM } from '~/shared/utils/constants';
import { defaultActiveCollectionId, viewCollections } from '../utils/viewCollections';
import {
  nextWindowSlot,
  resolveDropCell,
  isMainLayoutKey,
  DEFAULT_NEW_WINDOW_SIZE,
} from '../utils/layoutDefaults';

/** The one 60-column grid the canvas renders: page chrome plus the selected
 *  view's windows. The backend creates a layout for every view. */
function buildMergedLayout(mainLayout: Layout, viewLayout: Layout | undefined): Layout {
  return viewLayout ? [...mainLayout, ...viewLayout] : mainLayout;
}

function mergedLayoutFor(campaign: CampaignOutFull, view: ImageryViewOut | undefined): Layout {
  const mainLayout: Layout =
    campaign.personal_main_canvas_layout?.layout_data ||
    campaign.default_main_canvas_layout?.layout_data ||
    [];
  const viewLayout: Layout | undefined =
    view?.personal_canvas_layout?.layout_data || view?.default_canvas_layout?.layout_data;
  return buildMergedLayout(mainLayout, viewLayout);
}

function pinnedStartFor(viewId: number | null | undefined): number | undefined {
  return viewId != null
    ? usePreferencesStore.getState().taskStartCollectionByView[viewId]
    : undefined;
}

export type WorkMode = 'tasks' | 'explore';

interface CampaignStore {
  // State
  campaign: CampaignOutFull | null;
  isLoadingCampaign: boolean;
  isReviewMode: boolean;
  isAuthoritativeReviewer: boolean;
  isCampaignAdmin: boolean;
  /** Whether the current user is a member of the campaign's project (any role).
   *  Feeds the 'members' kind of labelling-policy audience checks. */
  isCampaignMember: boolean;
  /** Client-side work style within the annotation UI, independent of the
   *  campaign's DB-persisted default (campaign.mode). Seeded on load, then
   *  freely switchable via the Tasks | Explore toggle. */
  workMode: WorkMode;

  // KNN label validation status (embedding counts vs. thresholds). Refreshed
  // on campaign load and after each annotation submission so the tooltip in
  // AnnotationControls can explain why validation is / isn't available.
  knnValidationStatus: KnnValidationStatusOut | null;

  // View selection (replaces imagery selection)
  selectedViewId: number | null;

  // Layout
  currentLayout: Layout | null;
  savedLayout: Layout | null;
  isEditingLayout: boolean;
  /** Size (in grid units) applied to the next window added from the Hidden
   *  panel. Lets the user re-add many windows at a consistent, chosen size. */
  newWindowSize: { w: number; h: number };

  // Actions
  loadCampaign: (
    campaignId: number,
    initialTaskId?: number,
    isReviewMode?: boolean,
    initialWorkMode?: WorkMode,
    initialTaskSetId?: number,
    /** Explore deep link: start centred here and select the annotation. */
    initialFocus?: { lat: number; lon: number; annotationId?: number }
  ) => Promise<void>;
  refreshKnnValidationStatus: () => Promise<void>;
  setWorkMode: (mode: WorkMode) => void;
  setSelectedViewId: (id: number | null) => void;
  /** Refetch the campaign and rebuild the merged layout from server truth,
   *  keeping tasks/annotations untouched. Runs after every structural view
   *  change (they may re-sync layouts server-side). */
  reloadCampaign: (selectViewId?: number) => Promise<void>;
  /** Admin, edit mode: create a view containing every source, with all its
   *  collections as windows, and switch to it. */
  createView: () => Promise<void>;
  renameView: (viewId: number, name: string) => Promise<void>;
  deleteView: (viewId: number) => Promise<void>;
  moveView: (viewId: number, direction: -1 | 1) => Promise<void>;
  setViewSources: (viewId: number, sourceIds: number[]) => Promise<void>;
  setCurrentLayout: (layout: Layout) => void;
  setSavedLayout: (layout: Layout) => void;
  setIsEditingLayout: (isEditing: boolean) => void;
  setNewWindowSize: (size: { w: number; h: number }) => void;
  /** Remove a collection's window from the current layout. The grid stops
   *  rendering that window immediately; Save persists it as a personal hide. */
  hideWindow: (collectionId: number) => void;
  /** Remove every imagery window from the current layout at once, leaving the
   *  fixed page chrome in place. Lets the user re-add windows in a desired
   *  order to rebuild the layout from scratch. */
  hideAllWindows: () => void;
  /** Add a previously-hidden (or never-shown) collection window back into the
   *  current layout, packed into the next free grid slot at `newWindowSize`. */
  addWindow: (collectionId: number) => void;
  /** Add a window at an explicit grid cell (drag-and-drop placement), nudged
   *  down to the nearest collision-free row. Sized to `newWindowSize`. */
  addWindowAt: (collectionId: number, x: number, y: number) => void;
  saveLayout: (shouldBeDefault?: boolean) => Promise<void>;
  cancelLayoutEdit: () => void;
  resetLayout: (defaultLayout: Layout) => void;
  reset: () => void;
}

const initialState = {
  campaign: null as CampaignOutFull | null,
  isLoadingCampaign: false,
  isReviewMode: false,
  isAuthoritativeReviewer: false,
  isCampaignAdmin: false,
  isCampaignMember: false,
  workMode: 'explore' as WorkMode,
  knnValidationStatus: null as KnnValidationStatusOut | null,
  selectedViewId: null as number | null,
  currentLayout: null as Layout | null,
  savedLayout: null as Layout | null,
  isEditingLayout: false,
  newWindowSize: { ...DEFAULT_NEW_WINDOW_SIZE },
};

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  ...initialState,

  loadCampaign: async (
    campaignId,
    initialTaskId,
    isReviewMode,
    initialWorkMode,
    initialTaskSetId,
    initialFocus
  ) => {
    set({ isLoadingCampaign: true });

    try {
      const [campaignRes, tasksRes, setsRes] = await Promise.all([
        getCampaignWithImageryWindows({ path: { campaign_id: campaignId } }),
        getAllAnnotationTasks({ path: { campaign_id: campaignId } }),
        listTaskSets({ path: { campaign_id: campaignId } }),
      ]);

      const campaign = campaignRes.data!;
      const isAuthoritativeReviewer = campaign.viewer_is_authoritative_reviewer ?? false;
      const isCampaignAdmin = campaign.viewer_is_admin ?? false;
      const isCampaignMember = campaign.viewer_is_member ?? false;

      // View & layout
      const firstView = campaign.imagery_views[0];
      const selectedViewId = firstView?.id ?? null;
      const mergedLayout = mergedLayoutFor(campaign, firstView);

      // Active collection: the user's pinned start collection for this view if
      // still valid, otherwise the first window collection. Mirrors the task-nav
      // logic in task.store so the first task opens consistently with the rest.
      const activeCollectionId = defaultActiveCollectionId(
        campaign.imagery_sources,
        firstView,
        mergedLayout,
        pinnedStartFor(selectedViewId)
      );

      const workMode: WorkMode =
        initialWorkMode ?? (campaign.mode === 'open' ? 'explore' : 'tasks');

      // Map initial state for Explore. Kept keyed on the seeded workMode
      // (rather than always-seeded) because TaskModeMap and WindowMap read
      // currentMapCenter/currentMapZoom directly - unconditionally seeding
      // them would change Tasks mode's initial zoom behaviour today.
      let initialMapCenter: [number, number] | null = null;
      let initialMapZoom: number | null = null;
      if (workMode === 'explore') {
        initialMapCenter = initialFocus
          ? [initialFocus.lat, initialFocus.lon]
          : [
              (campaign.settings.bbox_south + campaign.settings.bbox_north) / 2,
              (campaign.settings.bbox_west + campaign.settings.bbox_east) / 2,
            ];
        const firstSource = campaign.imagery_sources[0];
        initialMapZoom = firstSource?.default_zoom ?? DEFAULT_MAP_ZOOM;
      }

      set({
        campaign,
        selectedViewId,
        currentLayout: mergedLayout,
        savedLayout: mergedLayout,
        isLoadingCampaign: false,
        isReviewMode: isReviewMode ?? false,
        isAuthoritativeReviewer,
        isCampaignAdmin,
        isCampaignMember,
        workMode,
      });

      // Initialize sibling stores. The centre crosshair is on by default for
      // Tasks work mode (point placement) but off for Explore, where free-form
      // drawing doesn't need it; the user can still toggle it with O.
      useMapStore.setState({
        currentMapCenter: initialMapCenter,
        currentMapZoom: initialMapZoom,
        currentMapBounds: null,
        showCrosshair: workMode === 'tasks',
      });
      // Use the action (not setState) so the reducer resolves the default
      // collection's cover_slice_index into activeSliceIndex.
      useMapStore.getState().setActiveCollectionId(activeCollectionId);

      // Process the tasks fetched above; no extra round-trip.
      await useTaskStore.getState().loadTasks(campaignId, initialTaskId, initialTaskSetId, {
        tasks: tasksRes.data!.tasks,
        taskSets: setsRes.data ?? [],
        isPublic: campaign.is_public,
      });

      // Zero-task campaigns have nothing to claim in Tasks mode - seed
      // straight into Explore instead, unless the caller (deep link/session
      // restore) explicitly asked for a mode.
      if (initialWorkMode === undefined && useTaskStore.getState().allTasks.length === 0) {
        get().setWorkMode('explore');
        useMapStore.setState({
          currentMapCenter: [
            (campaign.settings.bbox_south + campaign.settings.bbox_north) / 2,
            (campaign.settings.bbox_west + campaign.settings.bbox_east) / 2,
          ],
          currentMapZoom: campaign.imagery_sources[0]?.default_zoom ?? DEFAULT_MAP_ZOOM,
        });
      }

      // Explore annotations are served as vector tiles in the viewport, not
      // loaded upfront. Seed the tile cache-busting version from the campaign
      // for every campaign, since Explore can be entered from any of them.
      useAnnotationStore.getState().setCampaignVersion(campaign.annotations_version ?? 0);

      // Deep-linked annotation: arm the edit tool and stage the annotation for
      // it. The map consumes pendingEditAnnotationId once its edit interactions
      // exist; selecting here directly would be wiped on map mount.
      if (workMode === 'explore' && initialFocus?.annotationId !== undefined) {
        useMapStore.getState().setActiveTool('edit');
        useAnnotationStore.setState({ pendingEditAnnotationId: initialFocus.annotationId });
      }

      // Off the critical path: the tooltip it feeds isn't needed for first paint.
      void get().refreshKnnValidationStatus();
    } catch (error) {
      handleError(error, 'Failed to load campaign');
      set({ isLoadingCampaign: false });
    }
  },

  setSelectedViewId: (id) => {
    const { campaign, selectedViewId: previousViewId } = get();
    if (!campaign) return;

    const view = campaign.imagery_views.find((v) => v.id === id);
    const mergedLayout = mergedLayoutFor(campaign, view);

    // Save current view's map state before switching
    if (previousViewId !== null) {
      useMapStore.getState().saveViewSnapshot(previousViewId);
    }

    set({
      selectedViewId: id,
      currentLayout: mergedLayout,
      savedLayout: mergedLayout,
    });

    // Restore saved state for the new view, or initialize fresh
    const fallbackCollectionId = defaultActiveCollectionId(
      campaign.imagery_sources,
      view,
      mergedLayout,
      pinnedStartFor(id)
    );
    useMapStore.getState().restoreViewSnapshot(id, fallbackCollectionId);
  },

  reloadCampaign: async (selectViewId) => {
    const { campaign, selectedViewId } = get();
    if (!campaign) return;
    try {
      const res = await getCampaignWithImageryWindows({ path: { campaign_id: campaign.id } });
      const fresh = res.data;
      if (!fresh) return;
      const targetId = selectViewId ?? selectedViewId;
      const view = fresh.imagery_views.find((v) => v.id === targetId) ?? fresh.imagery_views[0];
      const mergedLayout = mergedLayoutFor(fresh, view);
      set({
        campaign: fresh,
        selectedViewId: view?.id ?? null,
        currentLayout: mergedLayout,
        savedLayout: mergedLayout,
      });
      // A structural change can remove the active collection from the view;
      // re-derive it whenever it is no longer browsable.
      const eligible = new Set(
        viewCollections(fresh.imagery_sources, view).map((e) => e.collection.id)
      );
      const active = useMapStore.getState().activeCollectionId;
      if (active === null || !eligible.has(active)) {
        useMapStore
          .getState()
          .setActiveCollectionId(
            defaultActiveCollectionId(
              fresh.imagery_sources,
              view,
              mergedLayout,
              pinnedStartFor(view?.id)
            )
          );
      }
    } catch (error) {
      handleError(error, 'Failed to reload campaign');
    }
  },

  createView: async () => {
    const { campaign } = get();
    if (!campaign) return;
    try {
      const res = await createImageryView({
        path: { campaign_id: campaign.id },
        body: {
          name: `View ${campaign.imagery_views.length + 1}`,
          source_ids: campaign.imagery_sources.map((s) => s.id),
        },
      });
      await get().reloadCampaign(res.data?.id);
    } catch (error) {
      handleError(error, 'Failed to create view');
    }
  },

  renameView: async (viewId, name) => {
    const { campaign } = get();
    if (!campaign) return;
    try {
      await updateImageryView({
        path: { campaign_id: campaign.id, view_id: viewId },
        body: { name },
      });
      await get().reloadCampaign();
    } catch (error) {
      handleError(error, 'Failed to rename view');
    }
  },

  deleteView: async (viewId) => {
    const { campaign } = get();
    if (!campaign) return;
    try {
      await deleteImageryView({ path: { campaign_id: campaign.id, view_id: viewId } });
      await get().reloadCampaign();
    } catch (error) {
      handleError(error, 'Failed to delete view');
    }
  },

  moveView: async (viewId, direction) => {
    const { campaign } = get();
    if (!campaign) return;
    const ids = campaign.imagery_views.map((v) => v.id);
    const idx = ids.indexOf(viewId);
    const target = idx + direction;
    if (idx === -1 || target < 0 || target >= ids.length) return;
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    try {
      await reorderImageryViews({
        path: { campaign_id: campaign.id },
        body: { view_ids: ids },
      });
      await get().reloadCampaign();
    } catch (error) {
      handleError(error, 'Failed to reorder views');
    }
  },

  setViewSources: async (viewId, sourceIds) => {
    const { campaign } = get();
    if (!campaign) return;
    try {
      await updateImageryView({
        path: { campaign_id: campaign.id, view_id: viewId },
        body: { source_ids: sourceIds },
      });
      await get().reloadCampaign();
    } catch (error) {
      handleError(error, 'Failed to update view sources');
    }
  },

  setWorkMode: (mode) => {
    // Entering Explore also drops any lingering review-mode flag - review is
    // a Tasks-only concept, so carrying it over would trap the UI in it with
    // no way back short of a reload.
    set({ workMode: mode, ...(mode === 'explore' ? { isReviewMode: false } : {}) });
    // Mirrors the load-time seeding: crosshair on for Tasks (point
    // placement), off for Explore (free-form drawing).
    useMapStore.setState({ showCrosshair: mode === 'tasks' });
  },

  refreshKnnValidationStatus: async () => {
    const { campaign } = get();
    if (!campaign) return;
    try {
      const res = await getKnnValidationStatus({ path: { campaign_id: campaign.id } });
      if (res.data) set({ knnValidationStatus: res.data });
    } catch (error) {
      handleError(error, 'Failed to refresh KNN validation status', {
        showUser: false,
        alertType: 'warning',
      });
    }
  },

  setCurrentLayout: (layout) => set({ currentLayout: layout }),
  setSavedLayout: (layout) => set({ savedLayout: layout }),
  setIsEditingLayout: (isEditing) => set({ isEditingLayout: isEditing }),
  setNewWindowSize: (size) => set({ newWindowSize: size }),

  hideWindow: (collectionId) =>
    set((s) => ({
      currentLayout: (s.currentLayout ?? []).filter((it) => it.i !== String(collectionId)),
    })),

  hideAllWindows: () =>
    set((s) => ({
      currentLayout: (s.currentLayout ?? []).filter((it) => isMainLayoutKey(it.i)),
    })),

  addWindow: (collectionId) =>
    set((s) => {
      const key = String(collectionId);
      const cur = s.currentLayout ?? [];
      if (cur.some((it) => it.i === key)) return {}; // already present
      const slot = nextWindowSlot(cur, s.newWindowSize);
      return { currentLayout: [...cur, { ...slot, i: key }] };
    }),

  addWindowAt: (collectionId, x, y) =>
    set((s) => {
      const key = String(collectionId);
      const without = (s.currentLayout ?? []).filter((it) => it.i !== key);
      const cell = resolveDropCell(without, x, y, s.newWindowSize);
      return { currentLayout: [...without, { i: key, ...cell, ...s.newWindowSize }] };
    }),

  saveLayout: async (shouldBeDefault = false) => {
    const { campaign, currentLayout, selectedViewId } = get();
    if (!campaign || !currentLayout || selectedViewId === null) {
      useLayoutStore.getState().showAlert('Cannot save layout: missing campaign or view', 'error');
      return;
    }

    try {
      const mainItems = currentLayout.filter((item) => isMainLayoutKey(item.i));
      const viewItems = currentLayout.filter((item) => !isMainLayoutKey(item.i));

      await createNewCanvasLayout({
        path: { campaign_id: campaign.id },
        body: {
          view_id: selectedViewId,
          should_be_default: shouldBeDefault,
          layout: {
            main_layout_data: mainItems,
            view_layout_data: viewItems.length > 0 ? viewItems : null,
          },
        },
      });

      const layoutType = shouldBeDefault ? 'default' : 'personal';
      useLayoutStore.getState().showAlert(`Layout saved successfully as ${layoutType}`, 'success');
      set({ savedLayout: currentLayout, isEditingLayout: false });
    } catch (error) {
      handleError(error, 'Failed to save layout');
    }
  },

  cancelLayoutEdit: () => {
    set({ currentLayout: get().savedLayout, isEditingLayout: false });
  },

  resetLayout: (defaultLayout) => {
    set({ currentLayout: defaultLayout, savedLayout: defaultLayout });
  },

  reset: () => set(initialState),
}));
