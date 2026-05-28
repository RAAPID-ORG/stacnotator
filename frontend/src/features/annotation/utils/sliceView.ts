/**
 * One place to ask "what slice should I show, and which ones are real".
 *
 * The data model has two related fields: `cover_slice_index` (which slice is
 * shown first) and `has_dedicated_cover` (true iff that slice is an
 * out-of-band cover with override viz params — exclude it from regular
 * navigation). Centralising the resolution avoids inline checks scattered
 * around the annotation feature.
 */

interface CollectionLike {
  cover_slice_index?: number | null;
  has_dedicated_cover?: boolean | null;
}

export interface SliceView {
  /** Index of the slice to show first (the collection's representative). */
  coverIndex: number;
  /** Slice indices that participate in a/d navigation — regular slices only,
   *  no out-of-band dedicated cover. */
  navIndices: number[];
  /** Slice indices visible in the time-picker dropdown: all regular slices
   *  plus the active cover. */
  pickerIndices: number[];
}

export function sliceView(
  sliceCount: number | undefined,
  coverSliceIndex: number | null | undefined,
  hasDedicatedCover: boolean | null | undefined
): SliceView {
  const coverIndex = coverSliceIndex ?? 0;
  if (!sliceCount) return { coverIndex, navIndices: [], pickerIndices: [] };
  const navIndices: number[] = [];
  const pickerIndices: number[] = [];
  for (let i = 0; i < sliceCount; i++) {
    const isDedicatedCover = !!hasDedicatedCover && i === coverIndex;
    if (!isDedicatedCover) navIndices.push(i);
    pickerIndices.push(i);
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
