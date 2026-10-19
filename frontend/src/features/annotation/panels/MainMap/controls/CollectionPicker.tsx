import { useLayoutStore } from '../../../stores/layout';
import { collectionsInView, type ImageryCatalog } from '../../../campaign/imagery';
import { useCampaignStore } from '../../../stores/campaign';
import { useImageryStore } from '../../../stores/imagery';
import { usePrefsStore } from '../../../stores/prefs';
import { HeaderSelect } from '../../../components/HeaderSelect';

export interface CollectionPickerProps {
  catalog: ImageryCatalog;
  sourceIds: number[];
  isTaskMode: boolean;
  /** Tooltip carrying the collection hotkeys, from the binding table. */
  title: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export function CollectionPicker({
  catalog,
  sourceIds,
  isTaskMode,
  title,
  expanded,
  onExpandedChange,
}: CollectionPickerProps) {
  const forcedOpen = useLayoutStore((s) => s.forcedOpenControl);
  const editing = useLayoutStore((s) => s.editing);
  const address = useImageryStore((s) => s.address);
  const activateCollection = useImageryStore((s) => s.activateCollection);
  const selectedViewId = useCampaignStore((s) => s.view?.id ?? null);
  const taskStartCollectionId = useCampaignStore((s) => s.taskStartCollectionId);
  const setTaskStartCollection = useCampaignStore((s) => s.setTaskStartCollection);
  const pinnedStart = usePrefsStore((s) => s.pinnedStart);
  const setPinnedStart = usePrefsStore((s) => s.setPinnedStart);

  const collections = collectionsInView(catalog, { source_ids: sourceIds });
  if (collections.length === 0 || (collections.length === 1 && !expanded && !onExpandedChange))
    return null;

  const pinnable = isTaskMode && selectedViewId != null;
  const pinned = selectedViewId != null ? pinnedStart[selectedViewId] : undefined;
  const effectiveStart =
    pinned != null && collections.some((collection) => collection.id === pinned)
      ? pinned
      : taskStartCollectionId;

  return (
    // timeline sidebar - it is what picks a window now.
    <span data-tour="collection-picker">
      <HeaderSelect
        value={address?.collectionId ?? ''}
        options={collections.map((c) => ({ value: c.id, label: c.name }))}
        onChange={(v: string | number) => activateCollection(catalog, Number(v))}
        title={title}
        inline={expanded}
        onInlineChange={editing ? onExpandedChange : undefined}
        label="Collections"
        forcedOpen={forcedOpen === 'collection-picker'}
        menuTourName="collection-picker-menu"
        markedValue={pinnable ? effectiveStart : undefined}
        onMarkOption={
          pinnable && selectedViewId != null
            ? (v) => {
                const collectionId = Number(v);
                setPinnedStart(selectedViewId, collectionId);
                setTaskStartCollection(collectionId);
              }
            : undefined
        }
        markActiveTitle="Show this collection first on every task (selected)"
        markInactiveTitle="Show this collection first on every task"
      />
    </span>
  );
}
