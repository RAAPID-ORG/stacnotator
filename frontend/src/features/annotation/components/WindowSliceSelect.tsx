import { useMemo } from 'react';
import { useMapStore } from '../stores/map.store';
import type { ImageryCollectionOut } from '~/api/client';
import { formatSliceLabel } from '~/shared/utils/utility';
import { resolveSliceIndex, sliceView } from '../utils/sliceView';
import HeaderSelect from './Map/HeaderSelect';

interface WindowSliceSelectProps {
  collection: ImageryCollectionOut;
  darkBg?: boolean;
}

export const WindowSliceSelect = ({ collection, darkBg = false }: WindowSliceSelectProps) => {
  const collectionSliceIndices = useMapStore((s) => s.collectionSliceIndices);
  const emptySlices = useMapStore((s) => s.emptySlices);
  const setCollectionSliceIndex = useMapStore((s) => s.setCollectionSliceIndex);

  const currentSliceIndex = resolveSliceIndex(collection, collectionSliceIndices[collection.id]);
  const slices = collection.slices;

  const options = useMemo(() => {
    const { pickerIndices } = sliceView(slices, collection.cover_slice_index);
    return pickerIndices.map((idx) => {
      const slice = slices[idx];
      const isEmpty = !!emptySlices[`${collection.id}-${idx}`];
      const baseLabel =
        slice.name ||
        (slice.start_date && slice.end_date
          ? formatSliceLabel(slice.start_date, slice.end_date, 'days', idx)
          : `Slice ${idx + 1}`);
      return {
        value: idx,
        label: `${baseLabel}${isEmpty ? ' (no data)' : ''}`,
        dimmed: isEmpty,
      };
    });
  }, [slices, emptySlices, collection.id, collection.cover_slice_index]);

  if (slices.length <= 1) return null;

  const handleChange = (val: string | number) => {
    setCollectionSliceIndex(collection.id, Number(val));
  };

  return (
    <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <HeaderSelect
        value={currentSliceIndex}
        options={options}
        onChange={handleChange}
        title="Select time slice"
        dark={darkBg}
        compact
      />
    </span>
  );
};
