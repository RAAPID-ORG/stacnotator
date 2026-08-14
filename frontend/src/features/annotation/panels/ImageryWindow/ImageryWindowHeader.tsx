import type { ImageryCollectionOut } from '~/api/client';
import { emptyKey } from '../../campaign/imageryNav';
import { slicePickerIndices } from '../../campaign/imageryNav';
import { useImageryStore } from '../../stores/imagery';
import { useCatalog } from '../../stores/campaign';
import { HeaderSelect } from '../../components/HeaderSelect';
import { selectWindowSlice, windowAddress } from './ImageryWindow';

export interface ImageryWindowHeaderProps {
  collection: ImageryCollectionOut;
}

function sliceLabel(collection: ImageryCollectionOut, index: number): string {
  return collection.slices[index]?.name || `Slice ${index + 1}`;
}

export function ImageryWindowHeader({ collection }: ImageryWindowHeaderProps) {
  const catalog = useCatalog();
  const imagery = useImageryStore();

  const isActive = imagery.address?.collectionId === collection.id;
  const address = windowAddress(catalog, imagery, collection.id);
  const indices = slicePickerIndices(collection);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
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
              const isEmpty = !!imagery.empties[emptyKey(collection.id, index)];
              return {
                value: index,
                label: `${sliceLabel(collection, index)}${isEmpty ? ' (no data)' : ''}`,
                dimmed: isEmpty,
              };
            })}
            onChange={(value: string | number) =>
              selectWindowSlice(catalog, imagery, collection.id, Number(value))
            }
          />
        </span>
      )}
    </div>
  );
}
