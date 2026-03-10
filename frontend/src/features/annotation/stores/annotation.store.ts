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

  loadAnnotations: (campaignId: number) => Promise<void>;
  saveAnnotation: (
    geometry: GeoJSON.Geometry,
    labelId: number,
    comment?: string | null
  ) => Promise<AnnotationOut | null>;
  updateAnnotationGeometry: (annotationId: number, geometry: GeoJSON.Geometry) => Promise<void>;
  deleteAnnotation: (annotationId: number) => Promise<void>;
  reset: () => void;
}

const initialState = {
  annotations: [] as AnnotationOut[],
  isLoadingAnnotations: false,
  isSaving: false,
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
      }));
      useLayoutStore.getState().showAlert('Annotation deleted successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete annotation';
      useLayoutStore.getState().showAlert(message, 'error');
      set({ isSaving: false });
      console.error('Delete annotation error:', error);
    }
  },

  reset: () => set(initialState),
}));
