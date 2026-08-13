import { collectionsInView, type Catalog } from '~/features/annotation/core/catalog';
import { usePrefsStore } from '~/features/annotation/stores';

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
