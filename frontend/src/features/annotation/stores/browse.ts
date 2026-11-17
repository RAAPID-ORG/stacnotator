import { create } from 'zustand';
import { listAnnotationsForCampaign, type AnnotationListItemOut } from '~/api/client';
import {
  annotationFilterQuery,
  NO_ANNOTATION_FILTERS,
  type AnnotationFilterState,
} from '~/features/campaigns/components/review/annotationFilterState';
import i18n from '~/shared/i18n';
import { handleError } from '~/shared/utils/errorHandler';
import { extentOf } from '../campaign/annotation';
import { fitAnnotation } from '../map/camera';
import { campaignState } from './campaign';
import { useImageryStore } from './imagery';
import { useWorkStore } from './work';

const t = i18n.getFixedT(null, 'panels');

/**
 * Stepping through a campaign's annotations in Explore, one at a time, in the order
 * and under the filters the review table uses. The list stays on the server: each step
 * fetches the single row at its position, so a campaign of any size costs one small
 * request per step.
 */
interface BrowseState {
  filters: AnnotationFilterState;
  /** Index into the filtered list of the annotation last stepped to. */
  position: number | null;
  total: number | null;
  busy: boolean;
  seed: (filters: AnnotationFilterState, position: number | null) => void;
  setFilters: (filters: AnnotationFilterState) => void;
  refreshTotal: () => Promise<void>;
  step: (delta: 1 | -1) => Promise<void>;
  reset: () => void;
}

const fetchAt = async (filters: AnnotationFilterState, offset: number) => {
  const { data } = await listAnnotationsForCampaign({
    path: { campaign_id: campaignState().campaign.id },
    query: { ...annotationFilterQuery(filters), limit: 1, offset },
    throwOnError: true,
  });
  return data;
};

async function openAnnotation(item: AnnotationListItemOut): Promise<void> {
  const imagery = useImageryStore.getState();
  if (item.task_id != null && !imagery.showTaskAnnotations) imagery.toggleTaskAnnotations();
  // Pan opens an annotation for reading; Edit is kept for someone already editing.
  const work = useWorkStore.getState();
  if (work.tool !== 'pan' && work.tool !== 'edit') await work.selectTool('pan');
  await useWorkStore.getState().openEdit(item.id);

  const opened = useWorkStore.getState().edit;
  if (opened?.annotation.id !== item.id) return;
  const { catalog } = campaignState();
  const address = useImageryStore.getState().address;
  const workingZoom = address
    ? (catalog.sources.get(address.sourceId)?.default_zoom ?? null)
    : null;
  fitAnnotation(extentOf(opened.geometry), workingZoom);
}

const initial = {
  filters: NO_ANNOTATION_FILTERS,
  position: null,
  total: null,
  busy: false,
};

export const useBrowseStore = create<BrowseState>((set, get) => ({
  ...initial,

  seed: (filters, position) => set({ ...initial, filters, position }),

  setFilters: (filters) => set({ filters, position: null, total: null }),

  refreshTotal: async () => {
    const { filters } = get();
    try {
      const page = await fetchAt(filters, 0);
      if (get().filters === filters) set({ total: page.total });
    } catch (error) {
      handleError(error, t('browse.loadFailed'));
    }
  },

  step: async (delta) => {
    const { filters, position, total, busy } = get();
    if (busy) return;
    const target = position === null ? (delta > 0 ? 0 : (total ?? 0) - 1) : position + delta;
    if (target < 0 || (total !== null && target >= total)) return;

    set({ busy: true });
    try {
      const page = await fetchAt(filters, target);
      // The filters changed while this was in flight; its row belongs to another list.
      if (get().filters !== filters) return;
      const item = page.items[0];
      set({ total: page.total, position: item ? target : position });
      if (item) await openAnnotation(item);
    } catch (error) {
      handleError(error, t('browse.loadFailed'));
    } finally {
      set({ busy: false });
    }
  },

  reset: () => set(initial),
}));
