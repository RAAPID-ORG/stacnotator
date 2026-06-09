/** Chronological ordering for a source's collections in the timeline.
 *
 * Collections are stored/referenced in insertion order, so a collection added
 * later but covering an earlier period (e.g. 2019 imagery added after 2020)
 * would otherwise show up at the end of the timeline. Ordering by the earliest
 * slice start date slots it into its proper place. */

interface DatedCollection {
  slices: { start_date: string }[];
}

/** Earliest slice start date (YYYY-MM-DD). Empty/undated collections sort last. */
export function collectionStartDate(collection: DatedCollection): string {
  let earliest = '';
  for (const s of collection.slices) {
    if (s.start_date && (!earliest || s.start_date < earliest)) earliest = s.start_date;
  }
  return earliest || '9999-99-99';
}

/** Stable chronological comparator for entries carrying a `collection`. */
export function byCollectionDate<T extends { collection?: DatedCollection | null }>(
  a: T,
  b: T
): number {
  const da = a.collection ? collectionStartDate(a.collection) : '9999-99-99';
  const db = b.collection ? collectionStartDate(b.collection) : '9999-99-99';
  return da.localeCompare(db);
}
