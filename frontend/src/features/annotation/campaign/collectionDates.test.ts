import { describe, expect, it } from 'vitest';
import { collectionStartDate } from './imagery';

const collection = (...starts: string[]) => ({
  slices: starts.map((start_date) => ({ start_date })),
});

describe('collectionStartDate', () => {
  it('returns the earliest slice start date', () => {
    expect(collectionStartDate(collection('2020-06-01', '2020-01-01', '2020-09-01'))).toBe(
      '2020-01-01'
    );
  });

  it('ignores empty slice dates when picking the earliest', () => {
    expect(collectionStartDate(collection('', '2019-03-01', ''))).toBe('2019-03-01');
  });

  it('sorts collections with no usable date last', () => {
    expect(collectionStartDate(collection())).toBe('9999-99-99');
    expect(collectionStartDate(collection('', ''))).toBe('9999-99-99');
  });
});
