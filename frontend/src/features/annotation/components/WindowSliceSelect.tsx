import { memo, useMemo } from 'react';
import { useMapStore } from '../stores/map.store';
import type { ImageryCollectionOut } from '~/api/client';
import { formatSliceLabel } from '~/shared/utils/utility';
import { resolveSliceIndex, sliceView } from '../utils/sliceView';
import HeaderSelect from './Map/HeaderSelect';

interface WindowSliceSelectProps {
  collection: ImageryCollectionOut;
  darkBg?: boolean;
}

const WindowSliceSelectImpl = ({ collection, darkBg = false }: WindowSliceSelectProps) => {
  // Subscribe per-collection, so another window's slice change doesn't re-render
  // every picker on the page.
  const sliceIndexForCollection = useMapStore((s) => s.collectionSliceIndices[collection.id]);
  // A primitive signature, so default equality only re-renders on our own empties.
  const emptySig = useMapStore((s) => {
    let sig = '';
    for (let i = 0; i < collection.slices.length; i++) {
      if (s.emptySlices[`${collection.id}-${i}`]) sig += `${i},`;
    }
    return sig;
  });
  const setCollectionSliceIndex = useMapStore((s) => s.setCollectionSliceIndex);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);

  const currentSliceIndex = resolveSliceIndex(collection, sliceIndexForCollection);
  const slices = collection.slices;

  const options = useMemo(() => {
    const emptyIdx = new Set(emptySig ? emptySig.split(',').filter(Boolean).map(Number) : []);
    const { pickerIndices } = sliceView(
      slices.length,
      collection.cover_slice_index,
      collection.has_dedicated_cover
    );
    return pickerIndices.map((idx) => {
      const slice = slices[idx];
      const isEmpty = emptyIdx.has(idx);
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
  }, [slices, emptySig, collection.cover_slice_index, collection.has_dedicated_cover]);

  if (slices.length <= 1) return null;

  const handleChange = (val: string | number) => {
    // Slice index first, then activate: setActiveCollectionId resolves
    // activeSliceIndex from collectionSliceIndices, so this order makes the
    // freshly picked slice the active one (main map + chart indicator follow).
    setCollectionSliceIndex(collection.id, Number(val));
    setActiveCollectionId(collection.id);
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

export const WindowSliceSelect = memo(WindowSliceSelectImpl);
