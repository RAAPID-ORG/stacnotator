/** Chronological ordering for imagery collections. Collections are stored in
 * insertion order, so later-added historical imagery must be sorted by its
 * earliest slice date wherever it is presented or navigated. */

interface DatedCollection {
  slices: { start_date?: string | null }[];
}

/** Earliest slice start date (YYYY-MM-DD). Empty/undated collections sort last. */
export function collectionStartDate(collection: DatedCollection): string {
  let earliest = '';
  for (const slice of collection.slices) {
    if (slice.start_date && (!earliest || slice.start_date < earliest)) {
      earliest = slice.start_date;
    }
  }
  return earliest || '9999-99-99';
}

/** Stable chronological comparator for entries carrying a collection. */
export function byCollectionDate<T extends { collection?: DatedCollection | null }>(
  a: T,
  b: T
): number {
  const first = a.collection ? collectionStartDate(a.collection) : '9999-99-99';
  const second = b.collection ? collectionStartDate(b.collection) : '9999-99-99';
  return first.localeCompare(second);
}
