/**
 * Nearest-slice search for the timeseries chart click: given a clicked point
 * in time, find the slice (across ALL sources' collections) whose date-range
 * midpoint is closest. Midpoint distance naturally favours the most specific
 * slice when ranges overlap (e.g. a weekly slice over its month Cover).
 *
 * Dedicated covers span a whole period rather than a point in time, so they
 * never win the search; slices without parseable dates are skipped. On a
 * distance tie the currently active source wins, so a click doesn't yank the
 * user to a sibling source that merely mirrors the active one's dates.
 */

interface SliceLike {
  start_date?: string | null;
  end_date?: string | null;
}

interface CollectionLike {
  id: number;
  cover_slice_index?: number | null;
  has_dedicated_cover?: boolean | null;
  slices: SliceLike[];
}

interface SourceLike {
  collections: CollectionLike[];
}

export interface NearestSliceResult {
  collectionId: number;
  sliceIndex: number;
}

export function findNearestSlice(
  sources: SourceLike[],
  clickedTime: number,
  activeCollectionId: number | null
): NearestSliceResult | null {
  // Active source first + strict `<` below = ties prefer the active source.
  const activeFirst = [...sources].sort((a, b) => {
    const aActive = a.collections.some((c) => c.id === activeCollectionId) ? 0 : 1;
    const bActive = b.collections.some((c) => c.id === activeCollectionId) ? 0 : 1;
    return aActive - bActive;
  });

  let best: (NearestSliceResult & { dist: number }) | null = null;
  for (const source of activeFirst) {
    for (const col of source.collections) {
      const dedicatedCoverIdx = col.has_dedicated_cover ? (col.cover_slice_index ?? 0) : -1;
      for (let i = 0; i < col.slices.length; i++) {
        if (i === dedicatedCoverIdx) continue;
        const slice = col.slices[i];
        if (!slice.start_date || !slice.end_date) continue;
        const start = new Date(slice.start_date).getTime();
        const end = new Date(slice.end_date).getTime();
        const dist = Math.abs((start + end) / 2 - clickedTime);
        if (Number.isNaN(dist)) continue;
        if (!best || dist < best.dist) best = { collectionId: col.id, sliceIndex: i, dist };
      }
    }
  }
  return best ? { collectionId: best.collectionId, sliceIndex: best.sliceIndex } : null;
}
