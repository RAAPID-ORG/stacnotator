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

interface VizSource {
  visualizations: { id: number; name: string }[];
}

interface VizSlice {
  tile_urls: { visualization_name: string }[];
}

/** The visualization to land on: `preferredVizId` when it is still published
 *  (has a tile_url) on the target slice, else the source's first
 *  visualization. Carries the annotator's chosen visualization across
 *  date/collection navigation without leaving a dangling reference to one a
 *  slice can't actually render. */
function resolveVizId(
  source: VizSource,
  slice: VizSlice | undefined,
  preferredVizId: string
): string {
  const preferred = source.visualizations.find((v) => String(v.id) === preferredVizId);
  const published =
    !!preferred && !!slice?.tile_urls.some((t) => t.visualization_name === preferred.name);
  return published ? preferredVizId : String(source.visualizations[0]?.id ?? '');
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
  const vizId = source ? resolveVizId(source, slice, preferredVizId) : preferredVizId;
  return { sourceId, collectionId, sliceIndex, vizId };
}

/** Address for jumping straight to a collection (timeline scrub, collection
 *  picker): lands on its cover slice, carrying the current visualization
 *  forward when the jump stays within the source it came from and that
 *  visualization is still published on the landing slice - resets to the
 *  target source's first visualization otherwise. */
export function jumpToCollection(
  cat: Catalog,
  collectionId: number,
  current: SliceAddress | null
): SliceAddress | null {
  const collection = cat.collections.get(collectionId);
  const sourceId = cat.sourceIdByCollectionId.get(collectionId);
  if (!collection || sourceId === undefined) return null;
  const preferredVizId = current && current.sourceId === sourceId ? current.vizId : '';
  return landOn(cat, sourceId, collectionId, coverIndex(collection), preferredVizId);
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
  return landOn(cat, addr.sourceId, target.id, coverIndex(target), addr.vizId);
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

  if (next !== undefined) return landOn(cat, addr.sourceId, addr.collectionId, next, addr.vizId);

  const target = neighborCollection(cat, addr, dir);
  if (!target) return null;
  return landOn(cat, addr.sourceId, target.id, landingIndex(target, empties, dir), addr.vizId);
}
