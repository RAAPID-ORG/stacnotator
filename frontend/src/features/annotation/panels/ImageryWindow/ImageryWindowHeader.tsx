import type { ImageryCollectionOut } from '~/api/client';
import { sliceLabel } from '../../campaign/imagery';
import { emptyKey } from '../../campaign/imageryNav';
import { slicePickerIndices } from '../../campaign/imageryNav';
import { useImageryStore } from '../../stores/imagery';
import { useCatalog } from '../../stores/campaign';
import { useSliceNotes } from '../../stores/work';
import { HeaderSelect } from '../../components/HeaderSelect';
import { NoteBadge, SliceCommentButton } from '../../chrome/SliceComments';
import { selectWindowSlice, windowAddress } from './ImageryWindow';

export interface ImageryWindowHeaderProps {
  collection: ImageryCollectionOut;
}

export function ImageryWindowHeader({ collection }: ImageryWindowHeaderProps) {
  const catalog = useCatalog();
  const imagery = useImageryStore();
  const notes = useSliceNotes();

  const isActive = imagery.address?.collectionId === collection.id;
  const address = windowAddress(catalog, imagery, collection.id);
  const indices = slicePickerIndices(collection);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <span
        data-window-active={isActive}
        className={`min-w-0 flex-1 truncate text-xs ${isActive ? 'font-semibold text-brand-700' : 'text-neutral-700'}`}
      >
        {collection.name}
      </span>
      {indices.length > 1 && address && (
        <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <HeaderSelect
            compact
            value={address.sliceIndex}
            title="Select time slice"
            options={indices.map((index) => {
              const slice = collection.slices[index];
              const isEmpty = !!imagery.empties[emptyKey(collection.id, index)];
              return {
                value: index,
                label: `${sliceLabel(slice, index)}${isEmpty ? ' (no data)' : ''}`,
                dimmed: isEmpty,
                badge: notes[slice.id] ? <NoteBadge /> : undefined,
              };
            })}
            onChange={(value: string | number) =>
              selectWindowSlice(catalog, imagery, collection.id, Number(value))
            }
          />
        </span>
      )}
      <SliceCommentButton compact address={address} hint="or double-click the map" />
    </div>
  );
}
