import { describe, it, expect } from 'vitest';
import { collectionStartDate, byCollectionDate } from './collectionOrder';

const col = (...starts: string[]) => ({
  slices: starts.map((start_date) => ({ start_date })),
});

describe('collectionStartDate', () => {
  it('returns the earliest slice start date', () => {
    expect(collectionStartDate(col('2020-06-01', '2020-01-01', '2020-09-01'))).toBe('2020-01-01');
  });

  it('ignores empty slice dates when picking the earliest', () => {
    expect(collectionStartDate(col('', '2019-03-01', ''))).toBe('2019-03-01');
  });

  it('sorts collections with no usable date last', () => {
    expect(collectionStartDate(col())).toBe('9999-99-99');
    expect(collectionStartDate(col('', ''))).toBe('9999-99-99');
  });
});

describe('byCollectionDate', () => {
  const entry = (id: number, ...starts: string[]) => ({ id, collection: col(...starts) });

  it('orders a later-added but earlier-dated collection ahead (the 2019-after-2020 case)', () => {
    // 2020 collection was added first, 2019 added afterwards.
    const items = [entry(1, '2020-01-01'), entry(2, '2019-01-01')];
    const ordered = [...items].sort(byCollectionDate).map((e) => e.id);
    expect(ordered).toEqual([2, 1]);
  });

  it('orders by earliest slice across multiple collections', () => {
    const items = [
      entry(1, '2021-05-01'),
      entry(2, '2019-07-01', '2019-01-01'),
      entry(3, '2020-02-01'),
    ];
    expect([...items].sort(byCollectionDate).map((e) => e.id)).toEqual([2, 3, 1]);
  });

  it('keeps undated collections at the end', () => {
    const items = [entry(1), entry(2, '2020-01-01'), entry(3, '2018-01-01')];
    expect([...items].sort(byCollectionDate).map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it('is stable for equal dates (preserves insertion order)', () => {
    const items = [entry(1, '2020-01-01'), entry(2, '2020-01-01'), entry(3, '2020-01-01')];
    expect([...items].sort(byCollectionDate).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('treats a null/missing collection as undated (sorts last)', () => {
    const items = [{ id: 1, collection: null }, entry(2, '2020-01-01')];
    expect([...items].sort(byCollectionDate).map((e) => e.id)).toEqual([2, 1]);
  });
});
