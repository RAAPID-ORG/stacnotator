import { create } from 'zustand';
import type { Layout } from 'react-grid-layout';
import {
  getCampaignWithImageryWindows,
  getCampaignUsers,
  createNewCanvasLayout,
  type CampaignOutFull,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { handleApiError } from '~/shared/utils/errorHandler';
import { useMapStore } from './map.store';
import { useTaskStore } from './task.store';
import { useAnnotationStore } from './annotation.store';
import { DEFAULT_MAP_ZOOM } from '~/shared/utils/constants';
import type { ImageryViewOut } from '~/api/client';

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

  // View selection (replaces imagery selection)
  selectedViewId: number | null;

  // Layout
  currentLayout: Layout | null;
  savedLayout: Layout | null;
  isEditingLayout: boolean;

  // Actions
  loadCampaign: (
    campaignId: number,
    initialTaskId?: number,
    isReviewMode?: boolean
  ) => Promise<void>;
  setSelectedViewId: (id: number | null) => void;
  setCurrentLayout: (layout: Layout) => void;
  setSavedLayout: (layout: Layout) => void;
  setIsEditingLayout: (isEditing: boolean) => void;
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
  selectedViewId: null as number | null,
  currentLayout: null as Layout | null,
  savedLayout: null as Layout | null,
  isEditingLayout: false,
};

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  ...initialState,

  loadCampaign: async (campaignId, initialTaskId, isReviewMode) => {
    set({ isLoadingCampaign: true });

    try {
      const [campaignRes, usersRes] = await Promise.all([
        getCampaignWithImageryWindows({ path: { campaign_id: campaignId } }),
        getCampaignUsers({ path: { campaign_id: campaignId } }),
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

      // Find the first collection with show_as_window from the first view
      const firstWindowRef = firstView?.collection_refs?.find((r) => r.show_as_window);
      const activeCollectionId = firstWindowRef?.collection_id ?? null;

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
        selectedViewId,
        currentLayout: mergedLayout,
        savedLayout: mergedLayout,
        isLoadingCampaign: false,
        isReviewMode: isReviewMode ?? false,
        isAuthoritativeReviewer,
        isCampaignAdmin,
      });

      // Initialize sibling stores
      useMapStore.setState({
        activeCollectionId,
        currentMapCenter: initialMapCenter,
        currentMapZoom: initialMapZoom,
        currentMapBounds: null,
      });

      // Load tasks
      await useTaskStore.getState().loadTasks(campaignId, initialTaskId);

      // Load open mode annotations
      if (campaign.mode === 'open') {
        await useAnnotationStore.getState().loadAnnotations(campaignId);
      }
    } catch (error) {
      handleApiError(error, 'Campaign load error', {
        defaultMessage: 'Failed to load campaign',
      });
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

  setCurrentLayout: (layout) => set({ currentLayout: layout }),
  setSavedLayout: (layout) => set({ savedLayout: layout }),
  setIsEditingLayout: (isEditing) => set({ isEditingLayout: isEditing }),

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
      const message = error instanceof Error ? error.message : 'Failed to save layout';
      useLayoutStore.getState().showAlert(message, 'error');
      console.error('Save layout error:', error);
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
