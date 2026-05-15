import { useCallback, useMemo } from 'react';
import { useCampaignStore } from '../stores/campaign.store';
import { useMapStore } from '../stores/map.store';

/**
 * Shared slice/collection navigation used by keyboard shortcuts and on-screen
 * arrow controls. Encapsulates "find next non-empty slice, wrapping to the
 * next collection" so both call sites agree on edge behavior.
 */
export const useSliceNavigation = () => {
  const campaign = useCampaignStore((s) => s.campaign);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);

  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);
  const setActiveSliceIndex = useMapStore((s) => s.setActiveSliceIndex);
  const setSliceNavIntent = useMapStore((s) => s.setSliceNavIntent);
  const emptySlices = useMapStore((s) => s.emptySlices);
  const collectionSliceIndices = useMapStore((s) => s.collectionSliceIndices);

  const selectedView = campaign?.imagery_views.find((v) => v.id === selectedViewId);

  const activeSourceId = useMemo(() => {
    if (!campaign || !activeCollectionId) return null;
    return (
      campaign.imagery_sources.find((s) => s.collections.some((c) => c.id === activeCollectionId))
        ?.id ?? null
    );
  }, [campaign, activeCollectionId]);

  const viewCollections = useMemo(() => {
    if (!selectedView || !campaign) return [];
    return selectedView.collection_refs
      .filter((ref) => activeSourceId == null || ref.source_id === activeSourceId)
      .map((ref) => {
        const source = campaign.imagery_sources.find((s) =>
          s.collections.some((c) => c.id === ref.collection_id)
        );
        const collection = source?.collections.find((c) => c.id === ref.collection_id);
        if (!source || !collection) return null;
        return { ...ref, collection, source };
      })
      .filter(Boolean) as {
      collection_id: number;
      source_id: number;
      show_as_window: boolean;
      collection: { id: number; slices: { name: string }[] };
      source: { id: number };
    }[];
  }, [selectedView, campaign, activeSourceId]);

  const currentCollectionIndex = viewCollections.findIndex(
    (c) => c.collection_id === activeCollectionId
  );
  const currentEntry = viewCollections[currentCollectionIndex];
  const currentSliceCount = Math.max(1, currentEntry?.collection.slices.length ?? 0);

  const firstNonEmptySlice = useCallback(
    (collectionId: number, totalSlices: number, preferredIndex = 0): number => {
      for (let offset = 0; offset < totalSlices; offset++) {
        const i = (preferredIndex + offset) % totalSlices;
        if (!emptySlices[`${collectionId}-${i}`]) return i;
      }
      return -1;
    },
    [emptySlices]
  );

  const navigateSlice = useCallback(
    (direction: 'next' | 'prev') => {
      if (!currentEntry) return;
      setSliceNavIntent(direction);
      const colId = currentEntry.collection_id;
      const nonEmpty: number[] = [];
      for (let i = 0; i < currentSliceCount; i++) {
        if (!emptySlices[`${colId}-${i}`]) nonEmpty.push(i);
      }

      if (direction === 'next') {
        const nextInCol = nonEmpty.find((i) => i > activeSliceIndex);
        if (nextInCol !== undefined) {
          setActiveSliceIndex(nextInCol);
        } else if (currentCollectionIndex < viewCollections.length - 1) {
          const next = viewCollections[currentCollectionIndex + 1];
          const nextCount = next.collection.slices.length;
          const landing = firstNonEmptySlice(next.collection_id, nextCount, 0);
          setActiveCollectionId(next.collection_id);
          if (landing > 0) setTimeout(() => setActiveSliceIndex(landing), 0);
        }
      } else {
        const prevInCol = [...nonEmpty].reverse().find((i) => i < activeSliceIndex);
        if (prevInCol !== undefined) {
          setActiveSliceIndex(prevInCol);
        } else if (currentCollectionIndex > 0) {
          const prev = viewCollections[currentCollectionIndex - 1];
          const prevCount = prev.collection.slices.length;
          let landing = -1;
          for (let i = prevCount - 1; i >= 0; i--) {
            if (!emptySlices[`${prev.collection_id}-${i}`]) {
              landing = i;
              break;
            }
          }
          if (landing < 0) return;
          setActiveCollectionId(prev.collection_id);
          setTimeout(() => setActiveSliceIndex(landing), 0);
        }
      }
    },
    [
      activeSliceIndex,
      currentSliceCount,
      currentCollectionIndex,
      currentEntry,
      viewCollections,
      emptySlices,
      setActiveSliceIndex,
      setActiveCollectionId,
      setSliceNavIntent,
      firstNonEmptySlice,
    ]
  );

  const navigateCollection = useCallback(
    (direction: 'next' | 'prev') => {
      if (viewCollections.length === 0) return;
      setSliceNavIntent('initial');
      const targetIdx =
        direction === 'next' ? currentCollectionIndex + 1 : currentCollectionIndex - 1;
      const target = viewCollections[targetIdx];
      if (!target) return;

      const storedSlice = collectionSliceIndices[target.collection_id] ?? 0;
      const isStoredEmpty = emptySlices[`${target.collection_id}-${storedSlice}`];
      setActiveCollectionId(target.collection_id);

      if (isStoredEmpty) {
        const fallback = firstNonEmptySlice(
          target.collection_id,
          target.collection.slices.length,
          storedSlice
        );
        if (fallback >= 0) setTimeout(() => setActiveSliceIndex(fallback), 0);
      }
    },
    [
      currentCollectionIndex,
      viewCollections,
      setActiveCollectionId,
      setActiveSliceIndex,
      setSliceNavIntent,
      firstNonEmptySlice,
      collectionSliceIndices,
      emptySlices,
    ]
  );

  const hasMultipleSlices = currentSliceCount > 1;
  const hasMultipleCollections = viewCollections.length > 1;

  return {
    navigateSlice,
    navigateCollection,
    hasMultipleSlices,
    hasMultipleCollections,
  };
};
