/**
 * One place to ask "what slice should I show, and which ones are real".
 *
 * The data model has two cover concepts that callers used to disambiguate at
 * every site: `cover_slice_index` (which slice is the representative one) and
 * `is_cover` (a separately-generated custom cover slice that doesn't belong
 * in the time series). Centralising the resolution avoids the inline
 * `!s.is_cover` / `idx === cover_slice_index` checks scattered around the
 * annotation feature.
 */

interface SliceLike {
  is_cover?: boolean | null;
}

interface CollectionLike {
  cover_slice_index?: number | null;
  slices: SliceLike[];
}

export interface SliceView {
  /** Index of the slice to show first (the collection's representative). */
  coverIndex: number;
  /** Slice indices that participate in a/d navigation — regular slices only,
   *  no custom-generated cover. */
  navIndices: number[];
  /** Slice indices visible in the time-picker dropdown: all regular slices
   *  plus the active cover. A custom cover slice is hidden when a regular
   *  slice has been designated as the cover (it would just duplicate the
   *  time series). */
  pickerIndices: number[];
}

export function sliceView(
  slices: readonly SliceLike[] | undefined,
  coverSliceIndex: number | null | undefined
): SliceView {
  const coverIndex = coverSliceIndex ?? 0;
  if (!slices) return { coverIndex, navIndices: [], pickerIndices: [] };
  const navIndices: number[] = [];
  const pickerIndices: number[] = [];
  for (let i = 0; i < slices.length; i++) {
    const isCustomCover = slices[i]?.is_cover === true;
    if (!isCustomCover) navIndices.push(i);
    if (!isCustomCover || i === coverIndex) pickerIndices.push(i);
  }
  return { coverIndex, navIndices, pickerIndices };
}

/** Slice index to actually display: caller's stored override if present,
 *  otherwise the collection's cover. */
export function resolveSliceIndex(
  collection: CollectionLike | null | undefined,
  stored: number | undefined
): number {
  return stored ?? collection?.cover_slice_index ?? 0;
}
