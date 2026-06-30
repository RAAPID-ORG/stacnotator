import { create } from 'zustand';
import type { Layout } from 'react-grid-layout';
import {
  getCampaignWithImageryWindows,
  getCampaignUsers,
  createNewCanvasLayout,
  getKnnValidationStatus,
  type CampaignOutFull,
  type KnnValidationStatusOut,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { useMapStore } from './map.store';
import { useTaskStore } from './task.store';
import { useAnnotationStore } from './annotation.store';
import { usePreferencesStore } from './preferences.store';
import { DEFAULT_MAP_ZOOM } from '~/shared/utils/constants';
import type { ImageryViewOut } from '~/api/client';
import {
  nextWindowSlot,
  resolveDropCell,
  MAIN_LAYOUT_KEYS,
  DEFAULT_NEW_WINDOW_SIZE,
} from '../utils/layoutDefaults';

/** Generate default window layout items for collections in a view that have show_as_window.
 *  Only used as a fallback when the backend didn't store a view layout (legacy campaigns). */
function generateFallbackWindowLayout(view: ImageryViewOut): Layout {
  const windowRefs = view.collection_refs.filter((r) => r.show_as_window);
  const COLS_PER_ROW = 6;
  const WINDOW_W = 10;
  const WINDOW_H = 11;
  const START_Y = 36; // directly below the main canvas
  return windowRefs.map((ref, idx) => ({
    i: String(ref.collection_id),
    x: (idx % COLS_PER_ROW) * WINDOW_W,
    y: START_Y + Math.floor(idx / COLS_PER_ROW) * WINDOW_H,
    w: WINDOW_W,
    h: WINDOW_H,
  }));
}

/** Merge main layout with view layout.
 *  The backend always creates a view layout, so viewLayout should always exist.
 *  The fallback generation only covers legacy campaigns created before view layouts were added. */
function buildMergedLayout(
  mainLayout: Layout,
  viewLayout: Layout | undefined,
  view: ImageryViewOut | undefined
): Layout {
  if (viewLayout) return [...mainLayout, ...viewLayout];
  // Fallback: view exists but has no stored layout (legacy campaign)
  if (view) {
    const generated = generateFallbackWindowLayout(view);
    return [...mainLayout, ...generated];
  }
  return mainLayout;
}

interface CampaignStore {
  // State
  campaign: CampaignOutFull | null;
  isLoadingCampaign: boolean;
  isReviewMode: boolean;
  isAuthoritativeReviewer: boolean;
  isCampaignAdmin: boolean;

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
    isReviewMode?: boolean
  ) => Promise<void>;
  refreshKnnValidationStatus: () => Promise<void>;
  setSelectedViewId: (id: number | null) => void;
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
  knnValidationStatus: null as KnnValidationStatusOut | null,
  selectedViewId: null as number | null,
  currentLayout: null as Layout | null,
  savedLayout: null as Layout | null,
  isEditingLayout: false,
  newWindowSize: { ...DEFAULT_NEW_WINDOW_SIZE },
};

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  ...initialState,

  loadCampaign: async (campaignId, initialTaskId, isReviewMode) => {
    set({ isLoadingCampaign: true });

    try {
      const [campaignRes, usersRes, knnRes] = await Promise.all([
        getCampaignWithImageryWindows({ path: { campaign_id: campaignId } }),
        getCampaignUsers({ path: { campaign_id: campaignId } }),
        getKnnValidationStatus({ path: { campaign_id: campaignId } }),
      ]);

      const campaign = campaignRes.data!;
      const campaignUsers = usersRes.data?.users ?? [];
      const currentUserId = useAccountStore.getState().account?.id;

      const currentCampaignUser = campaignUsers.find((cu) => cu.user.id === currentUserId);
      const isAuthoritativeReviewer = currentCampaignUser?.is_authorative_reviewer ?? false;
      const isCampaignAdmin = currentCampaignUser?.is_admin ?? false;

      // View & layout
      const firstView = campaign.imagery_views[0];
      const selectedViewId = firstView?.id ?? null;

      // Active collection: the user's pinned start collection for this view if
      // still valid, otherwise the first window collection. Mirrors the task-nav
      // logic in task.store so the first task opens consistently with the rest.
      const windowRefs = firstView?.collection_refs?.filter((r) => r.show_as_window) ?? [];
      const pinnedStart =
        selectedViewId != null
          ? usePreferencesStore.getState().taskStartCollectionByView[selectedViewId]
          : undefined;
      const pinnedValid = windowRefs.some((r) => r.collection_id === pinnedStart);
      const activeCollectionId = (pinnedValid ? pinnedStart : windowRefs[0]?.collection_id) ?? null;

      const mainLayout = (campaign.personal_main_canvas_layout?.layout_data ||
        campaign.default_main_canvas_layout?.layout_data) as unknown as Layout;
      const viewLayout = (firstView?.personal_canvas_layout?.layout_data ||
        firstView?.default_canvas_layout?.layout_data) as unknown as Layout | undefined;
      const mergedLayout = buildMergedLayout(mainLayout, viewLayout, firstView);

      // Map initial state for open mode
      let initialMapCenter: [number, number] | null = null;
      let initialMapZoom: number | null = null;
      if (campaign.mode === 'open') {
        initialMapCenter = [
          (campaign.settings.bbox_south + campaign.settings.bbox_north) / 2,
          (campaign.settings.bbox_west + campaign.settings.bbox_east) / 2,
        ];
        const firstSource = campaign.imagery_sources[0];
        initialMapZoom = firstSource?.default_zoom ?? DEFAULT_MAP_ZOOM;
      }

      set({
        campaign,
        knnValidationStatus: knnRes.data ?? null,
        selectedViewId,
        currentLayout: mergedLayout,
        savedLayout: mergedLayout,
        isLoadingCampaign: false,
        isReviewMode: isReviewMode ?? false,
        isAuthoritativeReviewer,
        isCampaignAdmin,
      });

      // Initialize sibling stores. The centre crosshair is on by default for
      // task mode (point placement) but off for open mode, where free-form
      // drawing doesn't need it; the user can still toggle it with O.
      useMapStore.setState({
        currentMapCenter: initialMapCenter,
        currentMapZoom: initialMapZoom,
        currentMapBounds: null,
        showCrosshair: campaign.mode !== 'open',
      });
      // Use the action (not setState) so the reducer resolves the default
      // collection's cover_slice_index into activeSliceIndex.
      useMapStore.getState().setActiveCollectionId(activeCollectionId);

      // Load tasks
      await useTaskStore.getState().loadTasks(campaignId, initialTaskId);

      // Open-mode annotations are served as vector tiles in the viewport, not
      // loaded upfront. Seed the tile cache-busting version from the campaign.
      if (campaign.mode === 'open') {
        useAnnotationStore.getState().setCampaignVersion(campaign.annotations_version ?? 0);
      }
    } catch (error) {
      handleError(error, 'Failed to load campaign');
      set({ isLoadingCampaign: false });
    }
  },

  setSelectedViewId: (id) => {
    const { campaign, selectedViewId: previousViewId } = get();
    if (!campaign) return;

    const view = campaign.imagery_views.find((v) => v.id === id);

    // Update layout
    const mainLayout = (campaign.personal_main_canvas_layout?.layout_data ||
      campaign.default_main_canvas_layout?.layout_data) as unknown as Layout;
    const viewLayout = (view?.personal_canvas_layout?.layout_data ||
      view?.default_canvas_layout?.layout_data) as unknown as Layout | undefined;
    const mergedLayout = buildMergedLayout(mainLayout, viewLayout, view);

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
    const firstWindowRef = view?.collection_refs?.find((r) => r.show_as_window);
    const fallbackCollectionId = firstWindowRef?.collection_id ?? null;
    useMapStore.getState().restoreViewSnapshot(id, fallbackCollectionId);
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
      currentLayout: (s.currentLayout ?? []).filter((it) => MAIN_LAYOUT_KEYS.has(it.i)),
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
      const mainItems = currentLayout.filter((item) =>
        ['main', 'timeseries', 'minimap', 'controls'].includes(item.i)
      );
      const viewItems = currentLayout.filter(
        (item) => !['main', 'timeseries', 'minimap', 'controls'].includes(item.i)
      );

      await createNewCanvasLayout({
        path: { campaign_id: campaign.id },
        body: {
          view_id: selectedViewId,
          should_be_default: shouldBeDefault,
          layout: {
            main_layout_data: mainItems,
            view_layout_data: viewItems.length > 0 ? viewItems : null,
            view_id: selectedViewId,
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
