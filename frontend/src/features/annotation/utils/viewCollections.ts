import type { ImageryCollectionOut, ImagerySourceOut, ImageryViewOut } from '~/api/client';
import { byCollectionDate } from './collectionOrder';

export interface ViewEntry {
  source: ImagerySourceOut;
  collection: ImageryCollectionOut;
}

/** The view's sources in its stored order, dropping stale ids. */
export function viewSources(
  sources: ImagerySourceOut[],
  view: Pick<ImageryViewOut, 'source_ids'> | null | undefined
): ImagerySourceOut[] {
  if (!view) return [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  return view.source_ids
    .map((id) => byId.get(id))
    .filter((s): s is ImagerySourceOut => s !== undefined);
}

/** Collections browsable in a view: every collection of the view's sources,
 *  in source order then the sources' own collection order. Whether one is a
 *  canvas window is decided by layout membership, not here. */
export function viewCollections(
  sources: ImagerySourceOut[],
  view: Pick<ImageryViewOut, 'source_ids'> | null | undefined
): ViewEntry[] {
  return viewSources(sources, view).flatMap((source) =>
    source.collections.map((collection) => ({ source, collection }))
  );
}

/** Default active collection for a view: the pinned start collection when
 *  still valid, else the chronologically first collection with a window in
 *  the layout, else the first browsable collection (so the main map keeps an
 *  imagery source even when every window is hidden). */
export function defaultActiveCollectionId(
  sources: ImagerySourceOut[],
  view: Pick<ImageryViewOut, 'source_ids'> | null | undefined,
  layout: readonly { i?: string }[] | null | undefined,
  pinned?: number
): number | null {
  const entries = viewCollections(sources, view).sort(byCollectionDate);
  const layoutKeys = new Set((layout ?? []).map((item) => item.i));
  const windows = entries.filter((e) => layoutKeys.has(String(e.collection.id)));
  const pool = windows.length > 0 ? windows : entries;
  if (pinned != null && pool.some((e) => e.collection.id === pinned)) return pinned;
  return pool[0]?.collection.id ?? null;
}
