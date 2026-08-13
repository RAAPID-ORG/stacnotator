import { collectionsInView, type Catalog } from './domain/catalog';
import { usePrefsStore } from './stores/prefs';

/** Which collection a view lands on: the user's pin when it still exists in
 *  that view, else its first collection. */
export function fallbackCollectionFor(
  cat: Catalog,
  viewId: number,
  sourceIds: number[]
): number | null {
  const collections = collectionsInView(cat, { source_ids: sourceIds });
  const pinned = usePrefsStore.getState().pinnedStart[viewId];
  if (pinned != null && collections.some((c) => c.id === pinned)) return pinned;
  return collections[0]?.id ?? null;
}
