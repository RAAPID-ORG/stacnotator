import { useTranslation } from 'react-i18next';
import { useLayoutStore } from '../../../stores/layout';
import { sliceLabel, type ImageryCatalog } from '../../../campaign/imagery';
import { emptyKey } from '../../../campaign/imageryNav';
import { addressAtSlice, slicePickerIndices } from '../../../campaign/imageryNav';
import { useImageryStore } from '../../../stores/imagery';
import { useSliceNotes } from '../../../stores/work';
import { HeaderSelect } from '../../../components/HeaderSelect';
import { NoteBadge } from '../../../chrome/SliceComments';

export function SlicePicker({
  catalog,
  title,
  expanded,
  onExpandedChange,
}: {
  catalog: ImageryCatalog;
  title: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { t } = useTranslation('panels');
  const forcedOpen = useLayoutStore((s) => s.forcedOpenControl);
  const editing = useLayoutStore((s) => s.editing);
  const address = useImageryStore((s) => s.address);
  const empties = useImageryStore((s) => s.empties);
  const setAddress = useImageryStore((s) => s.setAddress);
  const notes = useSliceNotes();

  const collection = address ? catalog.collections.get(address.collectionId) : undefined;
  if (
    !address ||
    !collection ||
    collection.slices.length === 0 ||
    (collection.slices.length === 1 && !expanded && !onExpandedChange)
  )
    return null;

  const options = slicePickerIndices(catalog, collection).map((index) => {
    const slice = collection.slices[index];
    const isEmpty = !!empties[emptyKey(collection.id, index)];
    return {
      value: index,
      label: isEmpty
        ? t('slices.empty', { label: sliceLabel(slice, index) })
        : sliceLabel(slice, index),
      dimmed: isEmpty,
      badge: notes[slice.id] ? <NoteBadge /> : undefined,
    };
  });

  return (
    <span data-tour="slice-picker">
      <HeaderSelect
        value={address.sliceIndex}
        options={options}
        onChange={(v: string | number) => setAddress(addressAtSlice(catalog, address, Number(v)))}
        title={title}
        inline={expanded}
        onInlineChange={editing ? onExpandedChange : undefined}
        label={t('slices.dates')}
        forcedOpen={forcedOpen === 'slice-picker'}
        menuTourName="slice-picker-menu"
      />
    </span>
  );
}
