import { create } from 'zustand';
import type { Layout } from 'react-grid-layout';
import {
  getCampaignWithImageryWindows,
  getCampaignUsers,
  createNewCanvasLayoutForImagery,
  type CampaignOutWithImageryWindows,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { handleApiError } from '~/shared/utils/errorHandler';
import { useMapStore } from './map.store';
import { useTaskStore } from './task.store';
import { useAnnotationStore } from './annotation.store';
import { DEFAULT_MAP_ZOOM } from '~/shared/utils/constants';

interface CampaignStore {
  // State
  campaign: CampaignOutWithImageryWindows | null;
  isLoadingCampaign: boolean;
  isReviewMode: boolean;
  isAuthoritativeReviewer: boolean;
  isCampaignAdmin: boolean;

  // Imagery selection
  selectedImageryId: number | null;

  // Layout
  currentLayout: Layout | null;
  savedLayout: Layout | null;
  isEditingLayout: boolean;

  // Actions
  loadCampaign: (campaignId: number, initialTaskId?: number, isReviewMode?: boolean) => Promise<void>;
  setSelectedImageryId: (id: number | null) => void;
  setCurrentLayout: (layout: Layout) => void;
  setSavedLayout: (layout: Layout) => void;
  setIsEditingLayout: (isEditing: boolean) => void;
  saveLayout: (shouldBeDefault?: boolean) => Promise<void>;
  cancelLayoutEdit: () => void;
  resetLayout: (defaultLayout: Layout) => void;
  reset: () => void;
}

const initialState = {
  campaign: null as CampaignOutWithImageryWindows | null,
  isLoadingCampaign: false,
  isReviewMode: false,
  isAuthoritativeReviewer: false,
  isCampaignAdmin: false,
  selectedImageryId: null as number | null,
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

      // Imagery & layout
      const selectedImageryId = campaign.imagery[0]?.id ?? null;
      const firstImagery = campaign.imagery[0];
      const activeWindowId = firstImagery?.default_main_window_id ?? firstImagery?.windows[0]?.id ?? null;

      const mainLayout = (campaign.personal_main_canvas_layout?.layout_data ||
        campaign.default_main_canvas_layout?.layout_data) as unknown as Layout;
      const imageryLayout = (firstImagery?.personal_canvas_layout?.layout_data ||
        firstImagery?.default_canvas_layout?.layout_data) as unknown as Layout | undefined;
      const mergedLayout = imageryLayout ? [...mainLayout, ...imageryLayout] : mainLayout;

      // Map initial state for open mode
      let initialMapCenter: [number, number] | null = null;
      let initialMapZoom: number | null = null;
      if (campaign.mode === 'open') {
        initialMapCenter = [
          (campaign.settings.bbox_south + campaign.settings.bbox_north) / 2,
          (campaign.settings.bbox_west + campaign.settings.bbox_east) / 2,
        ];
        initialMapZoom = firstImagery?.default_zoom ?? DEFAULT_MAP_ZOOM;
      }

      set({
        campaign,
        selectedImageryId,
        currentLayout: mergedLayout,
        savedLayout: mergedLayout,
        isLoadingCampaign: false,
        isReviewMode: isReviewMode ?? false,
        isAuthoritativeReviewer,
        isCampaignAdmin,
      });

      // Initialize sibling stores
      useMapStore.setState({
        activeWindowId,
        currentMapCenter: initialMapCenter,
        currentMapZoom: initialMapZoom,
        currentMapBounds: null,
      });

      // Load tasks (handles filtering, initial task selection, form state)
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

  setSelectedImageryId: (id) => {
    const { campaign, selectedImageryId: currentImageryId } = get();
    if (!campaign) return;

    const imagery = campaign.imagery.find((img) => img.id === id);

    // Update layout
    const mainLayout = (campaign.personal_main_canvas_layout?.layout_data ||
      campaign.default_main_canvas_layout?.layout_data) as unknown as Layout;
    const imageryLayout = (imagery?.personal_canvas_layout?.layout_data ||
      imagery?.default_canvas_layout?.layout_data) as unknown as Layout | undefined;
    const mergedLayout = imageryLayout ? [...mainLayout, ...imageryLayout] : mainLayout;

    // Find closest matching window in new imagery
    let newActiveWindowId = imagery?.default_main_window_id ?? imagery?.windows[0]?.id ?? null;
    const { activeWindowId } = useMapStore.getState();

    if (activeWindowId !== null && imagery) {
      const oldImagery = campaign.imagery.find((img) => img.id === currentImageryId);
      const currentWindow = oldImagery?.windows.find((w) => w.id === activeWindowId);

      if (currentWindow) {
        const currentMid = (new Date(currentWindow.window_start_date).getTime() +
          new Date(currentWindow.window_end_date).getTime()) / 2;
        let closest = imagery.windows[0];
        let smallestDiff = Number.MAX_SAFE_INTEGER;

        for (const w of imagery.windows) {
          const mid = (new Date(w.window_start_date).getTime() +
            new Date(w.window_end_date).getTime()) / 2;
          const diff = Math.abs(mid - currentMid);
          if (diff < smallestDiff) {
            smallestDiff = diff;
            closest = w;
          }
        }
        newActiveWindowId = closest.id;
      }
    }

    set({
      selectedImageryId: id,
      currentLayout: mergedLayout,
      savedLayout: mergedLayout,
    });

    useMapStore.setState({
      activeWindowId: newActiveWindowId,
      activeSliceIndex: 0,
      windowSliceIndices: {},
      emptySlices: {},
    });
  },

  setCurrentLayout: (layout) => set({ currentLayout: layout }),
  setSavedLayout: (layout) => set({ savedLayout: layout }),
  setIsEditingLayout: (isEditing) => set({ isEditingLayout: isEditing }),

  saveLayout: async (shouldBeDefault = false) => {
    const { campaign, currentLayout, selectedImageryId } = get();
    if (!campaign || !currentLayout || selectedImageryId === null) {
      useLayoutStore.getState().showAlert('Cannot save layout: missing campaign or imagery', 'error');
      return;
    }

    try {
      const mainItems = currentLayout.filter(
        (item) => ['main', 'timeseries', 'minimap', 'controls'].includes(item.i)
      );
      const imageryItems = currentLayout.filter(
        (item) => !['main', 'timeseries', 'minimap', 'controls'].includes(item.i)
      );

      await createNewCanvasLayoutForImagery({
        path: { campaign_id: campaign.id },
        body: {
          imagery_id: selectedImageryId,
          should_be_default: shouldBeDefault,
          layout: {
            main_layout_data: mainItems,
            imagery_layout_data: imageryItems.length > 0 ? imageryItems : null,
            imagery_id: selectedImageryId,
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
