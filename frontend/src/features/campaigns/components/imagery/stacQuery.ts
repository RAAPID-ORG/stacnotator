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
  { maxCloudCover, itemSort }: { maxCloudCover?: number; itemSort?: ItemSortOption }
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
      ],
    },
    filterLang: 'cql2-json',
    sortby: SORTBY[itemSort ?? 'date_desc'],
  };
};
