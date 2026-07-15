import { describe, it, expect } from 'vitest';
import { findNearestSlice } from './nearestSlice';

const day = (d: string) => new Date(d).getTime();

const sourceA = {
  collections: [
    {
      id: 10,
      cover_slice_index: 0,
      has_dedicated_cover: false,
      slices: [
        { start_date: '2024-01-01', end_date: '2024-01-31' },
        { start_date: '2024-06-01', end_date: '2024-06-30' },
      ],
    },
  ],
};

const sourceB = {
  collections: [
    {
      id: 40,
      cover_slice_index: 0,
      has_dedicated_cover: false,
      slices: [
        { start_date: '2024-09-01', end_date: '2024-09-07' },
        { start_date: '2024-09-08', end_date: '2024-09-14' },
      ],
    },
  ],
};

describe('findNearestSlice', () => {
  it('picks the nearest slice within the active source', () => {
    expect(findNearestSlice([sourceA, sourceB], day('2024-06-10'), 10)).toEqual({
      collectionId: 10,
      sliceIndex: 1,
    });
  });

  it('jumps to a sibling source when its slice is closer', () => {
    expect(findNearestSlice([sourceA, sourceB], day('2024-09-20'), 10)).toEqual({
      collectionId: 40,
      sliceIndex: 1,
    });
  });

  it('prefers the active source on a distance tie', () => {
    const mirrorOfA = {
      collections: [
        {
          id: 99,
          cover_slice_index: 0,
          has_dedicated_cover: false,
          slices: [{ start_date: '2024-06-01', end_date: '2024-06-30' }],
        },
      ],
    };
    expect(findNearestSlice([mirrorOfA, sourceA], day('2024-06-15'), 10)).toEqual({
      collectionId: 10,
      sliceIndex: 1,
    });
    expect(findNearestSlice([mirrorOfA, sourceA], day('2024-06-15'), 99)).toEqual({
      collectionId: 99,
      sliceIndex: 0,
    });
  });

  it('never picks a dedicated cover, even when its midpoint is closest', () => {
    const covered = {
      collections: [
        {
          id: 7,
          cover_slice_index: 0,
          has_dedicated_cover: true,
          slices: [
            { start_date: '2024-03-01', end_date: '2024-03-31' },
            { start_date: '2024-03-01', end_date: '2024-03-07' },
            { start_date: '2024-03-22', end_date: '2024-03-31' },
          ],
        },
      ],
    };
    expect(findNearestSlice([covered], day('2024-03-16'), 7)).toEqual({
      collectionId: 7,
      sliceIndex: 2,
    });
  });

  it('skips undated and unparseable slices', () => {
    const sparse = {
      collections: [
        {
          id: 5,
          cover_slice_index: 0,
          has_dedicated_cover: false,
          slices: [
            { start_date: null, end_date: null },
            { start_date: 'not-a-date', end_date: 'nope' },
            { start_date: '2024-02-01', end_date: '2024-02-29' },
          ],
        },
      ],
    };
    expect(findNearestSlice([sparse], day('2024-01-01'), 5)).toEqual({
      collectionId: 5,
      sliceIndex: 2,
    });
  });

  it('returns null when nothing is eligible', () => {
    const empty = { collections: [{ id: 1, slices: [] }] };
    expect(findNearestSlice([empty], day('2024-01-01'), 1)).toBeNull();
    expect(findNearestSlice([], day('2024-01-01'), null)).toBeNull();
  });
});
