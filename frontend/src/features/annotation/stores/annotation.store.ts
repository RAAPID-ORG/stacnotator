import { create } from 'zustand';
import {
  createAnnotationOpenmode,
  updateAnnotationOpenmode,
  deleteAnnotation as deleteAnnotationApi,
  getAllAnnotationsForCampaign,
  type AnnotationOut,
} from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { handleApiError } from '~/shared/utils/errorHandler';
import { convertGeoJSONToWKT } from '~/shared/utils/utility';
import { useCampaignStore } from './campaign.store';

interface OpenAnnotationStore {
  annotations: AnnotationOut[];
  isLoadingAnnotations: boolean;
  isSaving: boolean;
  /** Index into the annotations array sorted by updated_at for prev/next navigation. -1 = no selection */
  currentAnnotationIndex: number;
  /** ID of the annotation currently selected in edit mode (mirrors DrawingLayer state). */
  selectedAnnotationId: number | null;

  loadAnnotations: (campaignId: number) => Promise<void>;
  saveAnnotation: (
    geometry: GeoJSON.Geometry,
    labelId: number,
    comment?: string | null
  ) => Promise<AnnotationOut | null>;
  updateAnnotationGeometry: (annotationId: number, geometry: GeoJSON.Geometry) => Promise<void>;
  updateAnnotationFlags: (
    annotationId: number,
    flagged: boolean,
    flagComment: string | null
  ) => Promise<void>;
  deleteAnnotation: (annotationId: number) => Promise<void>;
  setSelectedAnnotationId: (id: number | null) => void;
  /** Navigate to previous annotation (older by updated_at) */
  goToPreviousAnnotation: () => AnnotationOut | null;
  /** Navigate to next annotation (newer by updated_at) */
  goToNextAnnotation: () => AnnotationOut | null;
  /** Get sorted annotations list (by updated_at descending - newest first) */
  getSortedAnnotations: () => AnnotationOut[];
  /** Set current annotation index directly */
  setCurrentAnnotationIndex: (index: number) => void;
  reset: () => void;
}

const initialState = {
  annotations: [] as AnnotationOut[],
  isLoadingAnnotations: false,
  isSaving: false,
  currentAnnotationIndex: -1,
  selectedAnnotationId: null as number | null,
};

export const useAnnotationStore = create<OpenAnnotationStore>((set, get) => ({
  ...initialState,

  loadAnnotations: async (campaignId) => {
    set({ isLoadingAnnotations: true });
    try {
      const response = await getAllAnnotationsForCampaign({
        path: { campaign_id: campaignId },
      });
      set({ annotations: response.data || [], isLoadingAnnotations: false });
    } catch (error) {
      handleApiError(error, 'Load annotations error', {
        defaultMessage: 'Failed to load annotations',
      });
      set({ isLoadingAnnotations: false });
    }
  },

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
        },
      });

      const annotation = response.data!;
      set((s) => ({
        annotations: [...s.annotations, annotation],
        isSaving: false,
      }));
      useLayoutStore.getState().showAlert('Annotation saved successfully', 'success');
      return annotation;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save annotation';
      useLayoutStore.getState().showAlert(message, 'error');
      set({ isSaving: false });
      console.error('Save annotation error:', error);
      return null;
    }
  },

  updateAnnotationGeometry: async (annotationId, geometry) => {
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign) return;

    const annotation = get().annotations.find((a) => a.id === annotationId);
    if (!annotation) return;

    set({ isSaving: true });
    try {
      const wktGeometry = convertGeoJSONToWKT(geometry);
      const response = await updateAnnotationOpenmode({
        path: { campaign_id: campaign.id, annotation_id: annotationId },
        body: {
          label_id: annotation.label_id,
          comment: annotation.comment,
          geometry_wkt: wktGeometry,
          is_authoritative: null,
        },
      });

      const updated = response.data!;
      set((s) => ({
        annotations: s.annotations.map((a) => (a.id === annotationId ? updated : a)),
        isSaving: false,
      }));
      useLayoutStore.getState().showAlert('Annotation updated successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update annotation';
      useLayoutStore.getState().showAlert(message, 'error');
      set({ isSaving: false });
      console.error('Update annotation error:', error);
      throw error; // Re-throw for rollback handling
    }
  },

  updateAnnotationFlags: async (annotationId, flagged, flagComment) => {
    const campaign = useCampaignStore.getState().campaign;
    if (!campaign) return;

    const annotation = get().annotations.find((a) => a.id === annotationId);
    if (!annotation) return;

    // Optimistic update so the UI reflects the toggle immediately.
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === annotationId
          ? { ...a, flagged_for_review: flagged, flag_comment: flagged ? flagComment : null }
          : a
      ),
    }));

    try {
      const response = await updateAnnotationOpenmode({
        path: { campaign_id: campaign.id, annotation_id: annotationId },
        body: {
          label_id: annotation.label_id,
          comment: annotation.comment,
          geometry_wkt: null,
          is_authoritative: null,
          flagged_for_review: flagged,
          flag_comment: flagged ? flagComment : null,
        },
      });
      const updated = response.data!;
      set((s) => ({
        annotations: s.annotations.map((a) => (a.id === annotationId ? updated : a)),
      }));
    } catch (error) {
      // Roll back on failure.
      set((s) => ({
        annotations: s.annotations.map((a) => (a.id === annotationId ? annotation : a)),
      }));
      const message = error instanceof Error ? error.message : 'Failed to update flag';
      useLayoutStore.getState().showAlert(message, 'error');
      console.error('Update flag error:', error);
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
        annotations: s.annotations.filter((a) => a.id !== annotationId),
        isSaving: false,
        currentAnnotationIndex: -1,
      }));
      useLayoutStore.getState().showAlert('Annotation deleted successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete annotation';
      useLayoutStore.getState().showAlert(message, 'error');
      set({ isSaving: false });
      console.error('Delete annotation error:', error);
    }
  },

  getSortedAnnotations: () => {
    const { annotations } = get();
    return [...annotations].sort((a, b) => {
      const aDate = a.updated_at || a.created_at;
      const bDate = b.updated_at || b.created_at;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
  },

  goToPreviousAnnotation: () => {
    const sorted = get().getSortedAnnotations();
    if (sorted.length === 0) return null;
    const { currentAnnotationIndex } = get();
    // Previous = newer in the list (lower index when sorted newest-first)
    let newIndex: number;
    if (currentAnnotationIndex < 0) {
      // No selection yet -> start at the first (newest)
      newIndex = 0;
    } else if (currentAnnotationIndex <= 0) {
      // Already at the start -> wrap to end
      newIndex = sorted.length - 1;
    } else {
      newIndex = currentAnnotationIndex - 1;
    }
    set({ currentAnnotationIndex: newIndex });
    return sorted[newIndex] ?? null;
  },

  goToNextAnnotation: () => {
    const sorted = get().getSortedAnnotations();
    if (sorted.length === 0) return null;
    const { currentAnnotationIndex } = get();
    // Next = older in the list (higher index when sorted newest-first)
    let newIndex: number;
    if (currentAnnotationIndex < 0) {
      // No selection yet -> start at the first (newest)
      newIndex = 0;
    } else if (currentAnnotationIndex >= sorted.length - 1) {
      // Already at the end -> wrap to start
      newIndex = 0;
    } else {
      newIndex = currentAnnotationIndex + 1;
    }
    set({ currentAnnotationIndex: newIndex });
    return sorted[newIndex] ?? null;
  },

  setCurrentAnnotationIndex: (index) => set({ currentAnnotationIndex: index }),

  setSelectedAnnotationId: (id) => set({ selectedAnnotationId: id }),

  reset: () => set(initialState),
}));
