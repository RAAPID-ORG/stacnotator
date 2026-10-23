import { sameValue } from '~/shared/utils/equality';
import type { ItemSortOption } from './types';

const SORTBY: Record<ItemSortOption, Array<{ field: string; direction: string }>> = {
  date_desc: [{ field: 'datetime', direction: 'desc' }],
  date_asc: [{ field: 'datetime', direction: 'asc' }],
  cloud_cover_asc: [
    { field: 'eo:cloud_cover', direction: 'asc' },
    { field: 'datetime', direction: 'desc' },
  ],
};

/** Canonical auto-generated STAC search query, shared by the wizard, the
 *  collection editor, and bulk apply. Cloud filtering must keep items without
 *  an `eo:cloud_cover` property (`isNull OR <=`), otherwise SAR/non-optical
 *  items are silently dropped at ingest and search. */
export const buildStacAutoQuery = (
  stacCollectionId: string,
  {
    maxCloudCover,
    itemSort,
    itemId,
  }: { maxCloudCover?: number; itemSort?: ItemSortOption; itemId?: string }
): Record<string, unknown> => {
  const cloudCoverFilter =
    maxCloudCover !== undefined && maxCloudCover < 100
      ? [
          {
            op: 'or',
            args: [
              { op: 'isNull', args: [{ property: 'eo:cloud_cover' }] },
              { op: '<=', args: [{ property: 'eo:cloud_cover' }, maxCloudCover] },
            ],
          },
        ]
      : [];

  return {
    collections: [stacCollectionId],
    filter: {
      op: 'and',
      args: [
        {
          op: 'anyinteracts',
          args: [{ property: 'datetime' }, { interval: ['{sliceStart}', '{sliceEnd}'] }],
        },
        ...cloudCoverFilter,
        // One chosen item rather than everything the slice's dates hold.
        ...(itemId ? [{ op: 'in', args: [{ property: 'id' }, [itemId]] }] : []),
      ],
    },
    filterLang: 'cql2-json',
    sortby: SORTBY[itemSort ?? 'date_desc'],
  };
};

/** The sort a stored query was built with, if it is one of ours. */
const itemSortOf = (query: unknown): ItemSortOption | undefined => {
  const sortby = (query as { sortby?: unknown } | null)?.sortby;
  return (Object.keys(SORTBY) as ItemSortOption[]).find((sort) => sameValue(SORTBY[sort], sortby));
};

/** The cloud-cover ceiling a stored query filters on, if any. */
export const cloudCoverOf = (node: unknown): number | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = cloudCoverOf(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  const { op, args } = node as { op?: unknown; args?: unknown };
  if (
    op === '<=' &&
    Array.isArray(args) &&
    sameValue(args[0], { property: 'eo:cloud_cover' }) &&
    typeof args[1] === 'number'
  ) {
    return args[1];
  }
  return cloudCoverOf(Object.values(node));
};

/**
 * A stored query split back into what the editor shows: the sort and cloud ceiling
 * it was built from, and the query itself only when someone wrote it by hand. A query
 * the auto-builder would produce again from those settings is not custom, so editing
 * the settings keeps changing it.
 */
export const readStoredQuery = (
  stacCollectionId: string,
  query: Record<string, unknown> | null | undefined,
  maxCloudCover: number | undefined
): { itemSort?: ItemSortOption; custom?: Record<string, unknown> } => {
  if (!query) return {};
  const itemSort = itemSortOf(query);
  const auto = buildStacAutoQuery(stacCollectionId, { maxCloudCover, itemSort });
  return { itemSort, custom: sameValue(auto, query) ? undefined : query };
};
