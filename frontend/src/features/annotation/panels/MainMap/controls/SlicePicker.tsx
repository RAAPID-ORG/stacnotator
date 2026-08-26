import { useLayoutStore } from '../../../stores/layout';
import { sliceLabel, type ImageryCatalog } from '../../../campaign/imagery';
import { emptyKey } from '../../../campaign/imageryNav';
import { addressAtSlice, slicePickerIndices } from '../../../campaign/imageryNav';
import { useImageryStore } from '../../../stores/imagery';
import { useSliceNotes } from '../../../stores/work';
import { HeaderSelect } from '../../../components/HeaderSelect';
import { NoteBadge } from '../../../chrome/SliceComments';

export function SlicePicker({ catalog, title }: { catalog: ImageryCatalog; title: string }) {
  const forcedOpen = useLayoutStore((s) => s.forcedOpenControl);
  const address = useImageryStore((s) => s.address);
  const empties = useImageryStore((s) => s.empties);
  const setAddress = useImageryStore((s) => s.setAddress);
  const notes = useSliceNotes();

  const collection = address ? catalog.collections.get(address.collectionId) : undefined;
  if (!address || !collection || collection.slices.length <= 1) return null;

  const options = slicePickerIndices(collection).map((index) => {
    const slice = collection.slices[index];
    const isEmpty = !!empties[emptyKey(collection.id, index)];
    return {
      value: index,
      label: `${sliceLabel(slice, index)}${isEmpty ? ' (empty)' : ''}`,
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
        forcedOpen={forcedOpen === 'slice-picker'}
        menuTourName="slice-picker-menu"
      />
    </span>
  );
}
