/**
 * Notes an annotator attaches to one imagery slice - "cloud over the field
 * here", "harvest already in" - alongside the single comment the annotation
 * itself carries. They ride on the annotation, so they are drafted while the
 * work is in progress and saved with it.
 */
import type { AnnotationOut } from '~/api/client';
import { sliceDateRange, type ImageryCatalog } from './imagery';
import type { SliceAddress } from './imageryNav';

export type SliceComment = NonNullable<AnnotationOut['slice_comments']>[number];

/** Notes keyed by slice id. An address is positional, the id is not, and the
 *  id is what the server stores - so it is what the draft is keyed by too. */
export type SliceNotes = Record<number, SliceComment>;

export function sliceIdAt(
  cat: ImageryCatalog,
  collectionId: number,
  sliceIndex: number
): number | null {
  return cat.collections.get(collectionId)?.slices[sliceIndex]?.id ?? null;
}

/** The note being written about the slice an address points at, snapshotting
 *  the imagery the way the annotation's own `imagery_*` columns do. Null when
 *  the address names a slice that is no longer in the catalog. */
export function sliceCommentAt(
  cat: ImageryCatalog,
  address: SliceAddress,
  text: string
): SliceComment | null {
  const slice = cat.collections.get(address.collectionId)?.slices[address.sliceIndex];
  if (!slice) return null;
  return {
    slice_id: slice.id,
    text,
    source_name: cat.sources.get(address.sourceId)?.name ?? null,
    start_date: slice.start_date ?? null,
    end_date: slice.end_date ?? null,
  };
}

/** Writing an empty note removes it: clearing the box is how a note is
 *  deleted, and an empty one would only be dropped by the server anyway. */
export function withNote(notes: SliceNotes, comment: SliceComment): SliceNotes {
  const next = { ...notes };
  if (comment.text.trim()) next[comment.slice_id] = comment;
  else delete next[comment.slice_id];
  return next;
}

export function toNotes(comments: SliceComment[] | null | undefined): SliceNotes {
  return Object.fromEntries((comments ?? []).map((c) => [c.slice_id, c]));
}

/** Wire payload, oldest slice first so the order is the imagery's rather than
 *  the order the annotator happened to visit them in. */
export function listNotes(notes: SliceNotes): SliceComment[] {
  return Object.values(notes).sort((a, b) =>
    (a.start_date ?? '').localeCompare(b.start_date ?? '')
  );
}

/** The imagery a note is about, as one line: "Sentinel-2, Jun 1 - Jun 7, 2023". */
export function describeSlice(comment: SliceComment): string {
  const dates = sliceDateRange(comment);
  return [comment.source_name, dates].filter(Boolean).join(', ') || `Slice ${comment.slice_id}`;
}
