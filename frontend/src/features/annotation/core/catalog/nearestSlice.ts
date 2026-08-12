import type { Catalog } from './catalog';
import type { SliceAddress } from './types';

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

/** Catalog-level wrapper: resolves the collectionId back to its owning
 *  source and returns a full SliceAddress, preserving the caller's current
 *  visualization (or defaulting to the target source's first one). */
export function nearestSlice(
  cat: Catalog,
  epochMs: number,
  addr: SliceAddress | null
): SliceAddress | null {
  const sources = [...cat.sources.values()];
  const best = findNearestSlice(sources, epochMs, addr?.collectionId ?? null);
  if (!best) return null;

  const sourceId = cat.sourceIdByCollectionId.get(best.collectionId);
  if (sourceId === undefined) return null;
  const source = cat.sources.get(sourceId);
  if (!source) return null;

  const vizId = addr?.vizId ?? String(source.visualizations[0]?.id ?? '');
  return { sourceId, collectionId: best.collectionId, sliceIndex: best.sliceIndex, vizId };
}
