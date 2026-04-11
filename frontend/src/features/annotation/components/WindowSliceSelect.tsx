import { useMapStore } from '../stores/map.store';
import type { ImageryCollectionOut } from '~/api/client';

interface WindowSliceSelectProps {
  collection: ImageryCollectionOut;
  darkBg?: boolean;
}

// Options are forced to dark-on-white because the native popup ignores the
// trigger's background colour, which would otherwise render white-on-white.
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

  if (slices.length <= 1) return null;

  const handleChange = (idx: number) => {
    setSliceNavIntent('pick');
    if (isActive) setActiveSliceIndex(idx);
    else setCollectionSliceIndex(collection.id, idx);
  };

  return (
    <select
      value={currentSliceIndex}
      onChange={(e) => handleChange(Number(e.target.value))}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      title="Select time slice"
      className={`text-[10px] h-5 pl-1.5 pr-4 py-0 border-0 rounded-sm cursor-pointer appearance-none focus:outline-none truncate underline decoration-dotted underline-offset-2 hover:decoration-solid transition-colors max-w-[11rem] ${
        darkBg
          ? 'text-white decoration-white/50 hover:bg-white/15'
          : 'text-neutral-700 decoration-neutral-400 hover:bg-neutral-100'
      }`}
      style={{
        backgroundImage: darkBg
          ? "url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%228%22%20height%3D%228%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20fill%3D%22%23ffffff%22%20d%3D%22M1.5%203.5l3.5%203.5%203.5-3.5%22%2F%3E%3C%2Fsvg%3E')"
          : "url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%228%22%20height%3D%228%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20fill%3D%22%23525252%22%20d%3D%22M1.5%203.5l3.5%203.5%203.5-3.5%22%2F%3E%3C%2Fsvg%3E')",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 4px center',
      }}
    >
      {slices.map((slice, idx) => {
        const key = `${collection.id}-${idx}`;
        const isEmpty = !!emptySlices[key];
        return (
          <option
            key={idx}
            value={idx}
            style={{ color: isEmpty ? '#a3a3a3' : '#1c1c1a', background: '#ffffff' }}
          >
            {slice.name}
            {isEmpty ? ' (no data)' : ''}
          </option>
        );
      })}
    </select>
  );
};
