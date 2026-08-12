import type { ImageryCollectionOut } from '~/api/client';
import type { Catalog } from './catalog';
import type { EmptyKey, SliceAddress } from './types';
import { emptyKey } from './types';
import { collectionStartDate } from './views';

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
 *  by stepCollection (direct Shift+A/D switch) and stepSlice's end-of-
 *  collection wrap - the two differ only in which slice they land on. */
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

/** Moves to the neighbor collection, landing on its cover slice -
 *  unconditionally, including a dedicated cover: a direct Shift+A/D switch
 *  always shows the collection's representative slice, never a
 *  within-collection nav slice.
 *  Null past the first/last collection. */
export function stepCollection(
  cat: Catalog,
  addr: SliceAddress,
  dir: 1 | -1,
  _empties: Record<EmptyKey, true>
): SliceAddress | null {
  const target = neighborCollection(cat, addr, dir);
  if (!target) return null;
  return { ...addr, collectionId: target.id, sliceIndex: coverIndex(target) };
}

/** Next/prev non-empty regular slice within the current collection; at a
 *  boundary, wraps into the neighbor collection landing on its first (dir=1)
 *  or last (dir=-1) nav slice, falling back to the cover only when none is
 *  eligible - distinct from stepCollection's unconditional cover landing on a
 *  direct collection switch. */
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

  if (next !== undefined) return { ...addr, sliceIndex: next };

  const target = neighborCollection(cat, addr, dir);
  if (!target) return null;
  return { ...addr, collectionId: target.id, sliceIndex: landingIndex(target, empties, dir) };
}
