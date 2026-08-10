import { useCallback, useMemo } from 'react';
import { useCampaignStore } from '../stores/campaign.store';
import { useMapStore } from '../stores/map.store';
import { sliceView } from '../utils/sliceView';
import { byCollectionDate } from '../utils/collectionOrder';
import { viewCollections, type ViewEntry } from '../utils/viewCollections';

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
  const setCollectionSliceIndex = useMapStore((s) => s.setCollectionSliceIndex);
  const emptySlices = useMapStore((s) => s.emptySlices);

  const selectedView = campaign?.imagery_views.find((v) => v.id === selectedViewId);

  const activeSourceId = useMemo(() => {
    if (!campaign || !activeCollectionId) return null;
    return (
      campaign.imagery_sources.find((s) => s.collections.some((c) => c.id === activeCollectionId))
        ?.id ?? null
    );
  }, [campaign, activeCollectionId]);

  const navCollections = useMemo<ViewEntry[]>(() => {
    if (!campaign) return [];
    return viewCollections(campaign.imagery_sources, selectedView)
      .filter((entry) => activeSourceId == null || entry.source.id === activeSourceId)
      .sort(byCollectionDate);
  }, [selectedView, campaign, activeSourceId]);

  const currentCollectionIndex = navCollections.findIndex(
    (c) => c.collection.id === activeCollectionId
  );
  const currentEntry = navCollections[currentCollectionIndex];
  const currentSliceCount = Math.max(1, currentEntry?.collection.slices.length ?? 0);

  /** Indices participating in a/d navigation: regular slices that aren't
   *  known to be empty. (Custom cover slices are excluded by sliceView.) */
  const sliceNavIndices = useCallback(
    (col: ViewEntry['collection']): number[] => {
      const { navIndices } = sliceView(
        col.slices.length,
        col.cover_slice_index,
        col.has_dedicated_cover
      );
      return navIndices.filter((i) => !emptySlices[`${col.id}-${i}`]);
    },
    [emptySlices]
  );

  const navigateSlice = useCallback(
    (direction: 'next' | 'prev') => {
      if (!currentEntry) return;
      const nonEmpty = sliceNavIndices(currentEntry.collection);

      const nextInCol =
        direction === 'next'
          ? nonEmpty.find((i) => i > activeSliceIndex)
          : [...nonEmpty].reverse().find((i) => i < activeSliceIndex);

      if (nextInCol !== undefined) {
        setActiveSliceIndex(nextInCol);
        return;
      }

      // End of current collection - step into the neighbour collection and
      // land on its first/last non-empty regular slice. Set the slice first
      // so setActiveCollectionId picks it up via collectionSliceIndices.
      const targetIdx =
        direction === 'next' ? currentCollectionIndex + 1 : currentCollectionIndex - 1;
      const target = navCollections[targetIdx];
      if (!target) return;
      const targetNav = sliceNavIndices(target.collection);
      const landing =
        direction === 'next'
          ? (targetNav[0] ?? target.collection.cover_slice_index ?? 0)
          : (targetNav[targetNav.length - 1] ?? target.collection.cover_slice_index ?? 0);
      setCollectionSliceIndex(target.collection.id, landing);
      setActiveCollectionId(target.collection.id);
    },
    [
      activeSliceIndex,
      currentCollectionIndex,
      currentEntry,
      navCollections,
      sliceNavIndices,
      setActiveSliceIndex,
      setActiveCollectionId,
      setCollectionSliceIndex,
    ]
  );

  /** Shift+a/d - switch collection. The reducer restores the per-collection
   *  remembered slice (or the cover_slice_index on first visit). */
  const navigateCollection = useCallback(
    (direction: 'next' | 'prev') => {
      if (navCollections.length === 0) return;
      const targetIdx =
        direction === 'next' ? currentCollectionIndex + 1 : currentCollectionIndex - 1;
      const target = navCollections[targetIdx];
      if (!target) return;
      setActiveCollectionId(target.collection.id);
    },
    [currentCollectionIndex, navCollections, setActiveCollectionId]
  );

  const hasMultipleSlices = currentSliceCount > 1;
  const hasMultipleCollections = navCollections.length > 1;

  return {
    navigateSlice,
    navigateCollection,
    hasMultipleSlices,
    hasMultipleCollections,
  };
};
