import type { ImageryCollectionOut } from '~/api/client';
import { compatibleVizId, type Catalog } from './catalog';
import type { EmptyKey, SliceAddress } from './types';
import { emptyKey } from './types';
import { collectionStartDate } from './collectionDates';

/**
 * Slice/collection stepping (A/D, Shift+A/D), plus the cover-slice rules
 * that decide which indices participate. The data model has two related
 * collection fields: `cover_slice_index` (the slice shown first) and
 * `has_dedicated_cover` (true iff that slice is an out-of-band cover with
 * override viz params - excluded from regular navigation).
 */

function coverIndex(collection: Pick<ImageryCollectionOut, 'cover_slice_index'>): number {
  return collection.cover_slice_index ?? 0;
}

function landOn(
  cat: Catalog,
  sourceId: number,
  collectionId: number,
  sliceIndex: number,
  preferredVizId: string
): SliceAddress {
  const source = cat.sources.get(sourceId);
  const slice = cat.collections.get(collectionId)?.slices[sliceIndex];
  const vizId = source ? compatibleVizId(source, slice, preferredVizId) : preferredVizId;
  return { sourceId, collectionId, sliceIndex, vizId };
}

/** Address for a direct date-picker selection. This uses the same compatible
 * visualization rule as keyboard navigation instead of changing the slice
 * index underneath a visualization that the target date does not publish. */
export function addressAtSlice(
  cat: Catalog,
  current: SliceAddress,
  sliceIndex: number
): SliceAddress {
  return landOn(cat, current.sourceId, current.collectionId, sliceIndex, current.vizId);
}

/** Resolve an address in another collection. The caller owns the landing
 * policy: passing a remembered slice resumes that collection's window;
 * omitting it deliberately selects the collection's cover/default. The
 * current visualization is carried within a source when the landing slice
 * publishes it, with the normal compatible-visualization fallback. */
export function collectionAddress(
  cat: Catalog,
  collectionId: number,
  current: SliceAddress | null,
  rememberedSliceIndex?: number
): SliceAddress | null {
  const collection = cat.collections.get(collectionId);
  const sourceId = cat.sourceIdByCollectionId.get(collectionId);
  if (!collection || sourceId === undefined) return null;
  const preferredVizId = current && current.sourceId === sourceId ? current.vizId : '';
  const sliceIndex = rememberedSliceIndex ?? coverIndex(collection);
  return landOn(cat, sourceId, collectionId, sliceIndex, preferredVizId);
}

/** All slice indices, for the listing/dropdown (includes the dedicated cover). */
export function slicePickerIndices(collection: Pick<ImageryCollectionOut, 'slices'>): number[] {
  return collection.slices.map((_, i) => i);
}

/** Indices participating in a/d stepping: regular slices that aren't a
 *  dedicated cover and aren't known-empty. */
export function sliceNavIndices(
  collection: ImageryCollectionOut,
  empties: Record<EmptyKey, true>
): number[] {
  const cover = coverIndex(collection);
  const out: number[] = [];
  for (let i = 0; i < collection.slices.length; i++) {
    const isDedicatedCover = !!collection.has_dedicated_cover && i === cover;
    if (isDedicatedCover) continue;
    if (empties[emptyKey(collection.id, i)]) continue;
    out.push(i);
  }
  return out;
}

function landingIndex(
  collection: ImageryCollectionOut,
  empties: Record<EmptyKey, true>,
  dir: 1 | -1
): number {
  const nav = sliceNavIndices(collection, empties);
  if (nav.length === 0) return coverIndex(collection);
  return dir === 1 ? nav[0] : nav[nav.length - 1];
}

function sourceCollectionsChronological(cat: Catalog, sourceId: number): ImageryCollectionOut[] {
  const source = cat.sources.get(sourceId);
  if (!source) return [];
  return [...source.collections].sort((a, b) =>
    collectionStartDate(a).localeCompare(collectionStartDate(b))
  );
}

/** The neighbor collection in chronological order within the same source
 *  (dir=1 next, dir=-1 prev), or null past the first/last collection. Shared
 *  by direct collection targeting and stepSlice's end-of-collection wrap. */
function neighborCollection(
  cat: Catalog,
  addr: SliceAddress,
  dir: 1 | -1
): ImageryCollectionOut | null {
  const ordered = sourceCollectionsChronological(cat, addr.sourceId);
  const idx = ordered.findIndex((c) => c.id === addr.collectionId);
  if (idx === -1) return null;
  return ordered[idx + dir] ?? null;
}

/** The neighboring collection id in chronological order. This deliberately
 * does not decide which slice to land on; the stateful caller knows whether
 * this is within-task navigation (resume the window) or a new-task reset
 * (use the cover). */
export function stepCollectionId(cat: Catalog, addr: SliceAddress, dir: 1 | -1): number | null {
  return neighborCollection(cat, addr, dir)?.id ?? null;
}

/** Next/prev non-empty regular slice within the current collection; at a
 *  boundary, wraps into the neighbor collection landing on its first (dir=1)
 *  or last (dir=-1) nav slice, falling back to the cover only when none is
 *  eligible. This chronological slice behavior is intentionally separate from
 *  direct collection activation, whose landing policy is owned by the store. */
export function stepSlice(
  cat: Catalog,
  addr: SliceAddress,
  dir: 1 | -1,
  empties: Record<EmptyKey, true>
): SliceAddress | null {
  const collection = cat.collections.get(addr.collectionId);
  if (!collection) return null;

  const nav = sliceNavIndices(collection, empties);
  const next =
    dir === 1
      ? nav.find((i) => i > addr.sliceIndex)
      : [...nav].reverse().find((i) => i < addr.sliceIndex);

  if (next !== undefined) return landOn(cat, addr.sourceId, addr.collectionId, next, addr.vizId);

  const target = neighborCollection(cat, addr, dir);
  if (!target) return null;
  return landOn(cat, addr.sourceId, target.id, landingIndex(target, empties, dir), addr.vizId);
}
