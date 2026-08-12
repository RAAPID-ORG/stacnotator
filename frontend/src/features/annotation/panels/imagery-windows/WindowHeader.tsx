import type { ImageryCollectionOut } from '~/api/client';
import { emptyKey, slicePickerIndices } from '~/features/annotation/core/catalog';
import { useImageryStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../../composition';
import { selectWindowSlice, useWindowSlice, windowAddress } from './WindowPanel';

export interface WindowHeaderProps {
  ctx: ComposeCtx;
  collection: ImageryCollectionOut;
}

function sliceLabel(collection: ImageryCollectionOut, index: number): string {
  return collection.slices[index]?.name || `Slice ${index + 1}`;
}

export function WindowHeader({ ctx, collection }: WindowHeaderProps) {
  const { catalog } = ctx;
  const imagery = useImageryStore();
  // The active collection already re-renders this via imagery.address; a
  // background window only repaints its picker when its own memory changes.
  useWindowSlice(collection.id);

  const isActive = imagery.address?.collectionId === collection.id;
  const address = windowAddress(catalog, imagery, collection.id);
  const indices = slicePickerIndices(collection);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span
        className={`min-w-0 flex-1 truncate text-xs ${isActive ? 'font-semibold text-brand-700' : 'text-neutral-700'}`}
      >
        {collection.name}
      </span>
      {indices.length > 1 && address && (
        <select
          value={address.sliceIndex}
          title="Select time slice"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            selectWindowSlice(catalog, imagery, collection.id, Number(e.target.value))
          }
          className="h-5 max-w-[7rem] rounded border border-neutral-200 bg-white text-[10px] text-neutral-700"
        >
          {indices.map((index) => {
            const isEmpty = !!imagery.empties[emptyKey(collection.id, index)];
            return (
              <option key={index} value={index}>
                {sliceLabel(collection, index)}
                {isEmpty ? ' (no data)' : ''}
              </option>
            );
          })}
        </select>
      )}
    </div>
  );
}
