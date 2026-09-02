import type { ImageryCollectionOut } from '~/api/client';
import {
  collectionStartDate,
  collectionsInView,
  type ImageryCatalog,
} from '../../campaign/imagery';
import { sliceNavIndices } from '../../campaign/imageryNav';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The collections the rail lays out: the view's, narrowed to the source the
 *  main map is on (the rail is a time axis, and two sources' periods are not
 *  one axis), oldest first. */
export function timelineCollections(
  catalog: ImageryCatalog,
  sourceIds: number[],
  activeSourceId: number | null
): ImageryCollectionOut[] {
  const inView = collectionsInView(catalog, { source_ids: sourceIds });
  const scoped =
    activeSourceId === null
      ? inView
      : inView.filter((c) => catalog.sourceOf.get(c.id) === activeSourceId);
  return [...scoped].sort((a, b) => collectionStartDate(a).localeCompare(collectionStartDate(b)));
}

export interface TimelineRange {
  start: string | null;
  end: string | null;
}

/** Earliest start and latest end across the collections' navigable slices - a
 *  dedicated cover is out-of-band imagery and would skew both ends. */
export function timelineRange(
  catalog: ImageryCatalog,
  collections: ImageryCollectionOut[]
): TimelineRange {
  let start: string | null = null;
  let end: string | null = null;
  for (const collection of collections) {
    for (const index of sliceNavIndices(catalog, collection, {})) {
      const slice = collection.slices[index];
      if (!start || slice.start_date < start) start = slice.start_date;
      if (!end || slice.end_date > end) end = slice.end_date;
    }
  }
  return { start, end };
}

/** Which of `count` equal segments a pointer `offsetY` into a `height` px
 *  track lands on; null when there is nothing to hit. Past either end it
 *  clamps to the nearest segment, so a drag that leaves the track keeps
 *  selecting rather than dropping out. */
export function segmentIndexAt(count: number, offsetY: number, height: number): number | null {
  if (count <= 0 || height <= 0) return null;
  const clamped = Math.max(0, Math.min(offsetY, height - 1));
  return Math.min(Math.floor((clamped / height) * count), count - 1);
}

/** 'Jan 2024' from an ISO date. Read off the string rather than through Date:
 *  a YYYY-MM-DD parses as UTC midnight, which is the previous month's last day
 *  for anyone west of Greenwich. */
export function monthYear(date: string | null): string {
  if (!date) return '';
  const match = /^(\d{4})-(\d{2})/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${month} ${match[1]}` : date;
}
