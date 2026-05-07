import { useMemo } from 'react';
import { useMapStore } from '../stores/map.store';
import type { ImageryCollectionOut } from '~/api/client';
import { formatSliceLabel } from '~/shared/utils/utility';
import HeaderSelect from './Map/HeaderSelect';

interface WindowSliceSelectProps {
  collection: ImageryCollectionOut;
  darkBg?: boolean;
}

export const WindowSliceSelect = ({ collection, darkBg = false }: WindowSliceSelectProps) => {
  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const collectionSliceIndices = useMapStore((s) => s.collectionSliceIndices);
  const emptySlices = useMapStore((s) => s.emptySlices);
  const setActiveSliceIndex = useMapStore((s) => s.setActiveSliceIndex);
  const setCollectionSliceIndex = useMapStore((s) => s.setCollectionSliceIndex);
  const setSliceNavIntent = useMapStore((s) => s.setSliceNavIntent);

  const isActive = collection.id === activeCollectionId;
  const currentSliceIndex = isActive
    ? activeSliceIndex
    : (collectionSliceIndices[collection.id] ?? 0);
  const slices = collection.slices;

  const options = useMemo(
    () =>
      slices.map((slice, idx) => {
        const isEmpty = !!emptySlices[`${collection.id}-${idx}`];
        const isCover = idx === collection.cover_slice_index;
        const baseLabel = isCover
          ? formatSliceLabel(slice.start_date, slice.end_date, 'days', idx)
          : slice.name;
        return {
          value: idx,
          label: `${baseLabel}${isEmpty ? ' (no data)' : ''}`,
          dimmed: isEmpty,
        };
      }),
    [slices, emptySlices, collection.id, collection.cover_slice_index]
  );

  if (slices.length <= 1) return null;

  const handleChange = (val: string | number) => {
    const idx = Number(val);
    setSliceNavIntent('pick');
    if (isActive) setActiveSliceIndex(idx);
    else setCollectionSliceIndex(collection.id, idx);
  };

  return (
    <HeaderSelect
      value={currentSliceIndex}
      options={options}
      onChange={handleChange}
      title="Select time slice"
      dark={darkBg}
      compact
    />
  );
};
