/**
 * Resolve the imagery slice currently shown in the open-mode main window into a
 * snapshot we persist onto an annotation. The slice id keeps traceability while
 * the start/end dates preserve what the annotator actually saw, even if the
 * slice is later edited or removed.
 */

import { useCampaignStore } from '../stores/campaign.store';
import { useMapStore } from '../stores/map.store';
import { resolveSliceIndex } from './sliceView';

export interface ImagerySnapshot {
  imagery_slice_id: number;
  imagery_source_name: string;
  imagery_start_date: string;
  imagery_end_date: string;
}

/** Snapshot of the main window's active slice, or null when no imagery is shown
 *  (basemap-only view, or no active collection). */
export function resolveActiveImagerySnapshot(): ImagerySnapshot | null {
  const { showBasemap, activeCollectionId, collectionSliceIndices } = useMapStore.getState();
  if (showBasemap || activeCollectionId === null) return null;

  const campaign = useCampaignStore.getState().campaign;
  if (!campaign) return null;

  for (const source of campaign.imagery_sources) {
    const collection = source.collections.find((c) => c.id === activeCollectionId);
    if (!collection) continue;
    const sliceIndex = resolveSliceIndex(collection, collectionSliceIndices[activeCollectionId]);
    const slice = collection.slices[sliceIndex] ?? collection.slices[0];
    if (!slice) return null;
    return {
      imagery_slice_id: slice.id,
      imagery_source_name: source.name,
      imagery_start_date: slice.start_date,
      imagery_end_date: slice.end_date,
    };
  }
  return null;
}
