import { describe, expect, it } from 'vitest';

import { formatSliceLabel, formatWindowLabel } from './utility';

describe('formatSliceLabel', () => {
  it('labels a weekly slice with its inclusive start and end days', () => {
    expect(formatSliceLabel('2026-05-01', '2026-05-07', 'weeks', 0)).toBe('May 1-7');
  });

  it('labels a weekly slice spanning a month boundary', () => {
    expect(formatSliceLabel('2026-05-29', '2026-06-04', 'weeks', 0)).toBe('May 29 - Jun 4');
  });

  it('labels a monthly slice by its month', () => {
    expect(formatSliceLabel('2026-05-01', '2026-05-31', 'months', 0)).toBe('May');
  });

  it('labels a single-day slice', () => {
    expect(formatSliceLabel('2026-05-01', '2026-05-01', 'days', 0)).toBe('May 1');
  });

  it('accepts the compact YYYYMMDD form', () => {
    expect(formatSliceLabel('20260501', '20260507', 'weeks', 0)).toBe('May 1-7');
  });
});

describe('formatWindowLabel', () => {
  it('labels a monthly window by month and year', () => {
    expect(formatWindowLabel('2026-05-01', '2026-05-31', 'months')).toBe('May 2026');
  });

  it('labels a weekly window with its inclusive day range', () => {
    expect(formatWindowLabel('2026-05-01', '2026-05-07', 'weeks')).toBe('May 1-7, 2026');
  });

  it('labels a window spanning several months of one year', () => {
    expect(formatWindowLabel('2026-05-01', '2026-07-31', 'months')).toBe('May-Jul 2026');
  });
});
