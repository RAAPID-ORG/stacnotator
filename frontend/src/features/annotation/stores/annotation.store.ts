import { create } from 'zustand';
import {
  createAnnotationOpenmode,
  updateAnnotationOpenmode,
  deleteAnnotation as deleteAnnotationApi,
  batchDeleteAnnotations as batchDeleteAnnotationsApi,
  getAnnotation as getAnnotationApi,
  getAnnotationNavigation,
  type AnnotationOut,
  type AnnotationNavItem,
} from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { convertGeoJSONToWKT } from '~/shared/utils/utility';
import { resolveActiveImagerySnapshot } from '../utils/imagerySnapshot';
import { useCampaignStore } from './campaign.store';

const NAV_BATCH_SIZE = 10;

interface OpenAnnotationStore {
  isSaving: boolean;

  /** Cache-busting key appended to annotation tile URLs. Initialised from the
   * campaign payload and bumped locally on every successful mutation. */
  tileVersion: number;
  /** Annotation currently open for single-feature geometry editing. The tile
   * layer renders this id transparent so the editable layer owns it. */
  editingId: number | null;

  /** Single selection (null when zero or multiple selected). */
  selectedAnnotationId: number | null;
  /** All ids selected in edit mode (single or multi-select). */
  selectedAnnotationIds: number[];
  /** Full record of the single selected annotation, fetched by id for the
   * controls panel (label, flags, comment). Null when 0 or many selected. */
  selectedAnnotationDetail: AnnotationOut | null;

  /** Label ids prev/next navigation is restricted to. Empty = all labels. */
  navigationLabelFilter: number[];
  /** Accumulated newest-first navigation buffer (lightweight items, no geometry). */
  navBuffer: AnnotationNavItem[];
  /** Position within navBuffer. -1 = nothing navigated yet. */
  currentAnnotationIndex: number;
  /** True once the server has no older items beyond the buffer. */
  navExhausted: boolean;

  setCampaignVersion: (version: number) => void;
  bumpTileVersion: () => void;
  setEditingId: (id: number | null) => void;

  saveAnnotation: (
    geometry: GeoJSON.Geometry,
    labelId: number,
    comment?: string | null
  ) => Promise<AnnotationOut | null>;
  updateAnnotationGeometry: (
    annotationId: number,
    geometry: GeoJSON.Geometry,
    meta: { labelId: number | null; comment: string | null }
  ) => Promise<void>;
  updateAnnotationFlags: (
    annotationId: number,
    flagged: boolean,
    flagComment: string | null
  ) => Promise<void>;
  deleteAnnotation: (annotationId: number) => Promise<void>;
  batchDeleteAnnotations: (annotationIds: number[]) => Promise<void>;

  setSelectedAnnotationId: (id: number | null) => void;
  setSelectedAnnotationIds: (ids: number[]) => void;

  goToPreviousAnnotation: () => Promise<AnnotationNavItem | null>;
  goToNextAnnotation: () => Promise<AnnotationNavItem | null>;
  setNavigationLabelFilter: (labelIds: number[]) => void;
  toggleNavigationLabel: (labelId: number) => void;

  reset: () => void;
}

const initialState = {
  isSaving: false,
  tileVersion: 0,
  editingId: null as number | null,
  selectedAnnotationId: null as number | null,
  selectedAnnotationIds: [] as number[],
  selectedAnnotationDetail: null as AnnotationOut | null,
  navigationLabelFilter: [] as number[],
  navBuffer: [] as AnnotationNavItem[],
  currentAnnotationIndex: -1,
  navExhausted: false,
};

async function fetchNavBatch(
  campaignId: number,
  labelIds: number[],
  cursor: AnnotationNavItem | undefined
): Promise<AnnotationNavItem[]> {
  const response = await getAnnotationNavigation({
    path: { campaign_id: campaignId },
    query: {
      label_ids: labelIds.length > 0 ? labelIds : undefined,
      cursor_updated_at: cursor?.updated_at,
      cursor_id: cursor?.id,
      limit: NAV_BATCH_SIZE,
    },
  });
  return response.data ?? [];
}

export const useAnnotationStore = create<OpenAnnotationStore>((set, get) => ({
  ...initialState,

  setCampaignVersion: (version) =>
    set({
      tileVersion: version,
      navBuffer: [],
      currentAnnotationIndex: -1,
      navExhausted: false,
    }),

  bumpTileVersion: () => set((s) => ({ tileVersion: s.tileVersion + 1 })),

  setEditingId: (id) => set({ editingId: id }),

  saveAnnotation: async (geometry, labelId, comment = null) => {
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign) return null;

    set({ isSaving: true });
    try {
      const wktGeometry = convertGeoJSONToWKT(geometry);
      const response = await createAnnotationOpenmode({
        path: { campaign_id: campaign.id },
        body: {
          label_id: labelId,
          comment: comment || null,
          geometry_wkt: wktGeometry,
          confidence: null,
          ...resolveActiveImagerySnapshot(),
        },
      });

      const annotation = response.data!;
      set((s) => ({ isSaving: false, tileVersion: s.tileVersion + 1 }));
      useLayoutStore.getState().showAlert('Annotation saved successfully', 'success');
      return annotation;
    } catch (error) {
      handleError(error, 'Failed to save annotation');
      set({ isSaving: false });
      return null;
    }
  },

  updateAnnotationGeometry: async (annotationId, geometry, meta) => {
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign) return;

    set({ isSaving: true });
    try {
      const wktGeometry = convertGeoJSONToWKT(geometry);
      await updateAnnotationOpenmode({
        path: { campaign_id: campaign.id, annotation_id: annotationId },
        body: {
          label_id: meta.labelId,
          comment: meta.comment,
          geometry_wkt: wktGeometry,
          is_authoritative: null,
          ...resolveActiveImagerySnapshot(),
        },
      });
      set((s) => ({ isSaving: false, tileVersion: s.tileVersion + 1 }));
      useLayoutStore.getState().showAlert('Annotation updated successfully', 'success');
    } catch (error) {
      handleError(error, 'Failed to update annotation');
      set({ isSaving: false });
      throw error;
    }
  },

  updateAnnotationFlags: async (annotationId, flagged, flagComment) => {
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign) return;

    const detail = get().selectedAnnotationDetail;
    // Optimistically reflect the toggle on the cached detail.
    if (detail && detail.id === annotationId) {
      set({
        selectedAnnotationDetail: {
          ...detail,
          flagged_for_review: flagged,
          flag_comment: flagged ? flagComment : null,
        },
      });
    }

    try {
      const response = await updateAnnotationOpenmode({
        path: { campaign_id: campaign.id, annotation_id: annotationId },
        body: {
          label_id: detail?.label_id ?? null,
          comment: detail?.comment ?? null,
          geometry_wkt: null,
          is_authoritative: null,
          flagged_for_review: flagged,
          flag_comment: flagged ? flagComment : null,
        },
      });
      const updated = response.data!;
      set((s) => ({
        selectedAnnotationDetail:
          s.selectedAnnotationDetail?.id === annotationId ? updated : s.selectedAnnotationDetail,
        tileVersion: s.tileVersion + 1,
      }));
    } catch (error) {
      // Roll back to the server's truth by refetching.
      void get().setSelectedAnnotationId(annotationId);
      handleError(error, 'Failed to update flag');
    }
  },

  deleteAnnotation: async (annotationId) => {
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign) return;

    set({ isSaving: true });
    try {
      await deleteAnnotationApi({
        path: { campaign_id: campaign.id, annotation_id: annotationId },
      });
      set((s) => ({
        isSaving: false,
        tileVersion: s.tileVersion + 1,
        editingId: s.editingId === annotationId ? null : s.editingId,
        selectedAnnotationId: null,
        selectedAnnotationIds: [],
        selectedAnnotationDetail: null,
      }));
      useLayoutStore.getState().showAlert('Annotation deleted successfully', 'success');
    } catch (error) {
      handleError(error, 'Failed to delete annotation');
      set({ isSaving: false });
    }
  },

  batchDeleteAnnotations: async (annotationIds) => {
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign || annotationIds.length === 0) return;

    set({ isSaving: true });
    try {
      const response = await batchDeleteAnnotationsApi({
        path: { campaign_id: campaign.id },
        body: { annotation_ids: annotationIds },
      });
      const deletedCount = response.data?.deleted_count ?? annotationIds.length;
      set((s) => ({
        isSaving: false,
        tileVersion: s.tileVersion + 1,
        editingId: null,
        selectedAnnotationId: null,
        selectedAnnotationIds: [],
        selectedAnnotationDetail: null,
      }));
      useLayoutStore.getState().showAlert(`Deleted ${deletedCount} annotation(s)`, 'success');
    } catch (error) {
      handleError(error, 'Failed to delete annotations');
      set({ isSaving: false });
    }
  },

  setSelectedAnnotationId: (id) => {
    set({
      selectedAnnotationId: id,
      selectedAnnotationIds: id === null ? [] : [id],
      selectedAnnotationDetail: null,
    });
    if (id === null) return;
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign) return;
    // Fetch the full record for the controls panel without blocking selection.
    void getAnnotationApi({ path: { campaign_id: campaign.id, annotation_id: id } })
      .then((response) => {
        if (response.data && get().selectedAnnotationId === id) {
          set({ selectedAnnotationDetail: response.data });
        }
      })
      .catch(() => {
        /* panel detail is best-effort */
      });
  },

  setSelectedAnnotationIds: (ids) => {
    const single = ids.length === 1 ? ids[0] : null;
    if (single !== null) {
      get().setSelectedAnnotationId(single);
    } else {
      set({
        selectedAnnotationIds: ids,
        selectedAnnotationId: null,
        selectedAnnotationDetail: null,
      });
    }
  },

  goToNextAnnotation: async () => {
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign) return null;

    const { currentAnnotationIndex, navExhausted } = get();
    let { navBuffer } = get();
    const atEnd = currentAnnotationIndex + 1 >= navBuffer.length;
    if (atEnd && !navExhausted) {
      const cursor = navBuffer[navBuffer.length - 1];
      const batch = await fetchNavBatch(campaign.id, get().navigationLabelFilter, cursor);
      navBuffer = [...navBuffer, ...batch];
      set({ navBuffer, navExhausted: batch.length < NAV_BATCH_SIZE });
    }

    navBuffer = get().navBuffer;
    if (navBuffer.length === 0) return null;
    const nextIndex = Math.min(currentAnnotationIndex + 1, navBuffer.length - 1);
    set({ currentAnnotationIndex: nextIndex });
    const item = navBuffer[nextIndex];
    get().setSelectedAnnotationId(item.id);
    return item;
  },

  goToPreviousAnnotation: async () => {
    const { navBuffer, currentAnnotationIndex } = get();
    if (navBuffer.length === 0) return null;
    const prevIndex = Math.max(currentAnnotationIndex - 1, 0);
    set({ currentAnnotationIndex: prevIndex });
    const item = navBuffer[prevIndex];
    get().setSelectedAnnotationId(item.id);
    return item;
  },

  setNavigationLabelFilter: (labelIds) =>
    set({
      navigationLabelFilter: labelIds,
      navBuffer: [],
      currentAnnotationIndex: -1,
      navExhausted: false,
    }),

  toggleNavigationLabel: (labelId) =>
    set((s) => ({
      navigationLabelFilter: s.navigationLabelFilter.includes(labelId)
        ? s.navigationLabelFilter.filter((id) => id !== labelId)
        : [...s.navigationLabelFilter, labelId],
      navBuffer: [],
      currentAnnotationIndex: -1,
      navExhausted: false,
    })),

  reset: () => set(initialState),
}));
