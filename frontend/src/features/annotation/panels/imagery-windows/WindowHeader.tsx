import type { ImageryCollectionOut } from '~/api/client';
import { emptyKey, slicePickerIndices } from '~/features/annotation/core/catalog';
import { useImageryStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../../composition';
import { HeaderSelect } from '../../shared/HeaderSelect';
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
            onChange={(value) => selectWindowSlice(catalog, imagery, collection.id, Number(value))}
          />
        </span>
      )}
    </div>
  );
}
