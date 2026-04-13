import { useMemo } from 'react';
import { useMapStore } from '../stores/map.store';
import type { ImageryCollectionOut } from '~/api/client';
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
        return {
          value: idx,
          label: `${slice.name}${isEmpty ? ' (no data)' : ''}`,
          dimmed: isEmpty,
        };
      }),
    [slices, emptySlices, collection.id]
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
