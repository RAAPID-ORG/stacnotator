import type { ImageryCollectionOut, ImageryViewOut } from '~/api/client';
import { compatibleVizId, type Catalog } from './catalog';
import {
  SNAPSHOT_FIELDS,
  type ImageryNavState,
  type SliceAddress,
  type ViewSnapshot,
} from './types';

/** Chronological ordering for a source's collections in the timeline.
 *  Collections are stored in insertion order, so a collection added later but
 *  covering an earlier period (e.g. 2019 imagery added after 2020) would
 *  otherwise show up at the end of the timeline; ordering by earliest slice
 *  start date slots it into its proper place. */

interface DatedCollection {
  slices: { start_date?: string | null }[];
}

/** Earliest slice start date (YYYY-MM-DD). Empty/undated collections sort last. */
export function collectionStartDate(collection: DatedCollection): string {
  let earliest = '';
  for (const s of collection.slices) {
    if (s.start_date && (!earliest || s.start_date < earliest)) earliest = s.start_date;
  }
  return earliest || '9999-99-99';
}

/** Stable chronological comparator for entries carrying a `collection`. */
export function byCollectionDate<T extends { collection?: DatedCollection | null }>(
  a: T,
  b: T
): number {
  const da = a.collection ? collectionStartDate(a.collection) : '9999-99-99';
  const db = b.collection ? collectionStartDate(b.collection) : '9999-99-99';
  return da.localeCompare(db);
}

/** Collections browsable in a view: every collection of the view's sources,
 *  in the view's stored source order then each source's own collection
 *  order. Stale source ids are dropped. */
export function collectionsInView(
  cat: Catalog,
  view: Pick<ImageryViewOut, 'source_ids'>
): ImageryCollectionOut[] {
  const out: ImageryCollectionOut[] = [];
  for (const sourceId of view.source_ids) {
    const source = cat.sources.get(sourceId);
    if (!source) continue;
    out.push(...source.collections);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-view snapshots. The saved field list (domain/catalog/types.ts's
// SNAPSHOT_FIELDS) includes vector layer + basemap selection.
// ---------------------------------------------------------------------------

function pickFields<T, K extends keyof T>(obj: T, fields: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const field of fields) result[field] = obj[field];
  return result;
}

/** Picks exactly the SNAPSHOT_FIELDS off the live navigation state - driven
 *  by the field list itself, so it can't drift from what SNAPSHOT_FIELDS says. */
export function snapshotForView(state: ImageryNavState): ViewSnapshot {
  return pickFields(state, SNAPSHOT_FIELDS);
}

/** Saved snapshot when present, else a fresh default at the fallback
 *  collection's cover slice (or a null address when there is none). */
export function restoreSnapshot(
  cat: Catalog,
  saved: ViewSnapshot | undefined,
  fallbackCollectionId: number | null
): ViewSnapshot {
  if (saved) return saved;
  return {
    address:
      fallbackCollectionId != null ? defaultAddressForCollection(cat, fallbackCollectionId) : null,
    showBasemap: false,
    selectedBasemapId: null,
    overlay: { id: null, visible: true },
    overlayOpacity: 1,
    vector: { id: null, visible: true },
  };
}

function defaultAddressForCollection(cat: Catalog, collectionId: number): SliceAddress | null {
  const collection = cat.collections.get(collectionId);
  const sourceId = cat.sourceIdByCollectionId.get(collectionId);
  if (!collection || sourceId === undefined) return null;
  const source = cat.sources.get(sourceId);
  if (!source) return null;
  const sliceIndex = collection.cover_slice_index ?? 0;
  return {
    sourceId,
    collectionId,
    sliceIndex,
    vizId: compatibleVizId(source, collection.slices[sliceIndex], ''),
  };
}
