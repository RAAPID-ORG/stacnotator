import { describe, expect, it } from 'vitest';

import { buildStacAutoQuery } from './stacQuery';

interface Cql2Filter {
  op: string;
  args: unknown[];
}

const filterArgs = (query: Record<string, unknown>): Cql2Filter[] =>
  (query.filter as Cql2Filter).args as Cql2Filter[];

describe('buildStacAutoQuery', () => {
  it('keeps property-less items with an isNull OR <= cloud filter', () => {
    const query = buildStacAutoQuery('sentinel-2-l2a', { maxCloudCover: 20 });

    const cloudFilter = filterArgs(query)[1];
    expect(cloudFilter.op).toBe('or');
    expect(cloudFilter.args).toEqual([
      { op: 'isNull', args: [{ property: 'eo:cloud_cover' }] },
      { op: '<=', args: [{ property: 'eo:cloud_cover' }, 20] },
    ]);
  });

  it('omits the cloud filter when unset or 100', () => {
    expect(filterArgs(buildStacAutoQuery('c', {}))).toHaveLength(1);
    expect(filterArgs(buildStacAutoQuery('c', { maxCloudCover: 100 }))).toHaveLength(1);
  });

  it('always emits sortby, defaulting to newest first', () => {
    expect(buildStacAutoQuery('c', {}).sortby).toEqual([{ field: 'datetime', direction: 'desc' }]);
    expect(buildStacAutoQuery('c', { itemSort: 'cloud_cover_asc' }).sortby).toEqual([
      { field: 'eo:cloud_cover', direction: 'asc' },
      { field: 'datetime', direction: 'desc' },
    ]);
  });

  it('scopes the query to the collection and slice placeholders', () => {
    const query = buildStacAutoQuery('sentinel-2-l2a', { maxCloudCover: 20 });

    expect(query.collections).toEqual(['sentinel-2-l2a']);
    expect(query.filterLang).toBe('cql2-json');
    expect(filterArgs(query)[0]).toEqual({
      op: 'anyinteracts',
      args: [{ property: 'datetime' }, { interval: ['{sliceStart}', '{sliceEnd}'] }],
    });
  });
});
