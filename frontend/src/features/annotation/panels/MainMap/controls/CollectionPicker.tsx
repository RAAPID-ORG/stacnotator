import { useTranslation } from 'react-i18next';
import { useLayoutStore } from '../../../stores/layout';
import { type ImageryCatalog } from '../../../campaign/imagery';
import { sourceStartCollectionId } from '../../../campaign/imageryNav';
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
  const { t } = useTranslation('panels');
  const forcedOpen = useLayoutStore((s) => s.forcedOpenControl);
  const editing = useLayoutStore((s) => s.editing);
  const address = useImageryStore((s) => s.address);
  const activateCollection = useImageryStore((s) => s.activateCollection);
  const hidden = useLayoutStore((s) => s.currentLayout.hidden);
  const refreshTaskStart = useCampaignStore((s) => s.refreshTaskStart);
  const pinnedStart = usePrefsStore((s) => s.pinnedStart);
  const setPinnedStart = usePrefsStore((s) => s.setPinnedStart);

  // Only the open source's collections: the source selector picks the source.
  const sourceId =
    address && sourceIds.includes(address.sourceId)
      ? address.sourceId
      : sourceIds.find((id) => (catalog.sources.get(id)?.collections.length ?? 0) > 0);
  const collections = sourceId != null ? (catalog.sources.get(sourceId)?.collections ?? []) : [];
  if (collections.length === 0 || (collections.length === 1 && !expanded && !onExpandedChange))
    return null;

  const pinnable = isTaskMode && sourceId != null;
  const effectiveStart =
    sourceId != null ? sourceStartCollectionId(catalog, sourceId, pinnedStart, hidden) : null;

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
        label={t('collections.label')}
        forcedOpen={forcedOpen === 'collection-picker'}
        menuTourName="collection-picker-menu"
        markedValue={pinnable ? effectiveStart : undefined}
        onMarkOption={
          pinnable && sourceId != null
            ? (v) => {
                setPinnedStart(sourceId, Number(v));
                refreshTaskStart();
              }
            : undefined
        }
        markActiveTitle={t('collections.pinnedStart')}
        markInactiveTitle={t('collections.pinStart')}
      />
    </span>
  );
}
