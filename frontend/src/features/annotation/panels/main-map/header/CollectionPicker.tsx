import { collectionsInView, type Catalog } from '~/features/annotation/core/catalog';
import { useImageryStore, usePrefsStore, useSessionStore } from '~/features/annotation/stores';
import { HeaderSelect } from '../../../shared/HeaderSelect';

export interface CollectionPickerProps {
  catalog: Catalog;
  sourceIds: number[];
  isTaskMode: boolean;
  /** Tooltip carrying the collection hotkeys, from the binding table. */
  title: string;
}

export function CollectionPicker({ catalog, sourceIds, isTaskMode, title }: CollectionPickerProps) {
  const address = useImageryStore((s) => s.address);
  const setActiveCollection = useImageryStore((s) => s.setActiveCollection);
  const selectedViewId = useSessionStore((s) => s.selectedViewId);
  const pinnedStart = usePrefsStore((s) => s.pinnedStart);
  const setPinnedStart = usePrefsStore((s) => s.setPinnedStart);

  const collections = collectionsInView(catalog, { source_ids: sourceIds });
  if (collections.length <= 1) return null;

  const pinnable = isTaskMode && selectedViewId != null;
  const pinned = selectedViewId != null ? pinnedStart[selectedViewId] : undefined;

  return (
    // timeline sidebar - it is what picks a window now.
    <span data-tour="collection-picker">
      <HeaderSelect
        value={address?.collectionId ?? ''}
        options={collections.map((c) => ({ value: c.id, label: c.name }))}
        onChange={(v) => setActiveCollection(catalog, Number(v))}
        title={title}
        markedValue={pinnable ? (pinned ?? null) : undefined}
        onMarkOption={
          pinnable && selectedViewId != null
            ? (v) => setPinnedStart(selectedViewId, pinned === Number(v) ? null : Number(v))
            : undefined
        }
        markActiveTitle="Opens first on every task - click to clear"
        markInactiveTitle="Show this collection first on every task"
      />
    </span>
  );
}
