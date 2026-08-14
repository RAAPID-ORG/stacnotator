import type { ImagerySliceOut } from '~/api/client';
import { emptyKey, type Catalog } from '../../../campaign/catalog';
import { addressAtSlice, slicePickerIndices } from '../../../campaign/imageryNav';
import { useImageryStore } from '../../../stores/imagery';
import { HeaderSelect } from '../../../components/HeaderSelect';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/** '' for an unparseable date rather than 'Invalid Date'. */
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

function sliceLabel(slice: ImagerySliceOut, index: number): string {
  if (slice.name) return slice.name;
  if (slice.start_date && slice.end_date) {
    return `${formatDate(slice.start_date)} - ${formatDate(slice.end_date)}`;
  }
  if (slice.start_date) return formatDate(slice.start_date);
  return `Slice ${index + 1}`;
}

export function SlicePicker({ catalog, title }: { catalog: Catalog; title: string }) {
  const address = useImageryStore((s) => s.address);
  const empties = useImageryStore((s) => s.empties);
  const setAddress = useImageryStore((s) => s.setAddress);

  const collection = address ? catalog.collections.get(address.collectionId) : undefined;
  if (!address || !collection || collection.slices.length <= 1) return null;

  const options = slicePickerIndices(collection).map((index) => {
    const isEmpty = !!empties[emptyKey(collection.id, index)];
    return {
      value: index,
      label: `${sliceLabel(collection.slices[index], index)}${isEmpty ? ' (empty)' : ''}`,
      dimmed: isEmpty,
    };
  });

  return (
    <HeaderSelect
      value={address.sliceIndex}
      options={options}
      onChange={(v: string | number) => setAddress(addressAtSlice(catalog, address, Number(v)))}
      title={title}
    />
  );
}
