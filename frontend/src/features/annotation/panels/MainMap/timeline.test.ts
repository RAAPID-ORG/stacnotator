import { describe, expect, it } from 'vitest';
import { buildImageryCatalog } from '../../campaign/imagery';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
} from '~/features/annotation/testing/fixtures';
import { monthYear, segmentIndexAt, timelineCollections, timelineRange } from './timeline';

const slice = (start: string, end: string) => makeSlice({ start_date: start, end_date: end });

const s2 = makeSource({
  id: 1,
  collections: [
    makeCollection({ id: 20, name: '2021', slices: [slice('2021-01-01', '2021-01-31')] }),
    makeCollection({ id: 10, name: '2019', slices: [slice('2019-06-01', '2019-06-30')] }),
  ],
});

const vhr = makeSource({
  id: 2,
  collections: [
    makeCollection({ id: 30, name: 'VHR', slices: [slice('2022-03-01', '2022-03-31')] }),
  ],
});

const catalog = buildImageryCatalog(makeCampaign({ imagery_sources: [s2, vhr] }));

describe('timelineCollections', () => {
  it('orders a later-added but earlier-dated collection first', () => {
    const ids = timelineCollections(catalog, [1], 1).map((c) => c.id);
    expect(ids).toEqual([10, 20]);
  });

  it('shows only the active source, so the rail stays one time axis', () => {
    expect(timelineCollections(catalog, [1, 2], 2).map((c) => c.id)).toEqual([30]);
  });

  it('falls back to every collection of the view when no source is active', () => {
    expect(timelineCollections(catalog, [1, 2], null).map((c) => c.id)).toEqual([10, 20, 30]);
  });

  it('drops collections of sources the view does not carry', () => {
    expect(timelineCollections(catalog, [2], null).map((c) => c.id)).toEqual([30]);
  });
});

describe('timelineRange', () => {
  it('spans the earliest start to the latest end', () => {
    expect(timelineRange(catalog, timelineCollections(catalog, [1], 1))).toEqual({
      start: '2019-06-01',
      end: '2021-01-31',
    });
  });

  it('ignores a dedicated cover, whose dates are out of band', () => {
    const collection = makeCollection({
      has_dedicated_cover: true,
      cover_slice_index: 0,
      slices: [slice('2010-01-01', '2030-12-31'), slice('2020-01-01', '2020-01-31')],
    });
    expect(timelineRange(catalog, [collection])).toEqual({
      start: '2020-01-01',
      end: '2020-01-31',
    });
  });

  it('has no range without collections', () => {
    expect(timelineRange(catalog, [])).toEqual({ start: null, end: null });
  });
});

describe('segmentIndexAt', () => {
  it('maps a position to its segment', () => {
    expect(segmentIndexAt(4, 0, 100)).toBe(0);
    expect(segmentIndexAt(4, 30, 100)).toBe(1);
    expect(segmentIndexAt(4, 99, 100)).toBe(3);
  });

  it('clamps past either end rather than dropping the drag', () => {
    expect(segmentIndexAt(4, -50, 100)).toBe(0);
    expect(segmentIndexAt(4, 500, 100)).toBe(3);
  });

  it('has nothing to hit without segments or height', () => {
    expect(segmentIndexAt(0, 10, 100)).toBeNull();
    expect(segmentIndexAt(4, 10, 0)).toBeNull();
  });
});

describe('monthYear', () => {
  it('labels a date by its own month, not the viewer time zone', () => {
    expect(monthYear('2024-01-01')).toBe('Jan 2024');
    expect(monthYear('2024-12-31')).toBe('Dec 2024');
  });

  it('passes through what it cannot read', () => {
    expect(monthYear('')).toBe('');
    expect(monthYear(null)).toBe('');
    expect(monthYear('not a date')).toBe('not a date');
    expect(monthYear('2024-13-01')).toBe('2024-13-01');
  });
});
