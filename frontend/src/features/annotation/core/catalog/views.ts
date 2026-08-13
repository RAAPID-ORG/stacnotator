import type { ImageryCollectionOut, ImageryViewOut } from '~/api/client';
import type { Catalog } from './catalog';
import { collectionAddress } from './timeNav';
import { SNAPSHOT_FIELDS, type ImageryNavState, type ViewSnapshot } from './types';

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
      fallbackCollectionId != null ? collectionAddress(cat, fallbackCollectionId, null) : null,
    showBasemap: false,
    selectedBasemapId: null,
    overlay: { id: null, visible: true },
    overlayOpacity: 1,
    vector: { id: null, visible: true },
  };
}
