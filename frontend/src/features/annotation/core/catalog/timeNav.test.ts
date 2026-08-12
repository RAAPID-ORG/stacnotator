import { describe, it, expect } from 'vitest';
import { buildCatalog } from './catalog';
import { makeCampaign, makeCollection, makeSlice, makeSource, makeViz } from './testHelpers';
import { emptyKey } from './types';
import { sliceNavIndices, slicePickerIndices, stepCollection, stepSlice } from './timeNav';

const collectionWithCover = makeCollection({
  id: 10,
  name: 'Col',
  has_dedicated_cover: true,
  slices: [
    makeSlice({ id: 100, name: 's0-cover' }),
    makeSlice({ id: 101, name: 's1' }),
    makeSlice({ id: 102, name: 's2' }),
    makeSlice({ id: 103, name: 's3' }),
  ],
});

describe('sliceNavIndices / slicePickerIndices (cover-slice rules)', () => {
  it('excludes the dedicated cover from stepping but includes it in the picker listing', () => {
    expect(sliceNavIndices(collectionWithCover, {})).toEqual([1, 2, 3]);
    expect(slicePickerIndices(collectionWithCover)).toEqual([0, 1, 2, 3]);
  });

  it('includes the cover in stepping when it is not a dedicated cover', () => {
    const col = { ...collectionWithCover, has_dedicated_cover: false };
    expect(sliceNavIndices(col, {})).toEqual([0, 1, 2, 3]);
  });

  it('skips slices marked empty', () => {
    const empties = { [emptyKey(10, 2)]: true as const };
    expect(sliceNavIndices(collectionWithCover, empties)).toEqual([1, 3]);
  });
});

// ---------------------------------------------------------------------------
// stepSlice / stepCollection
// ---------------------------------------------------------------------------

const source = makeSource({
  id: 1,
  name: 'S',
  visualizations: [makeViz({ id: 900, name: 'True Color' })],
  collections: [
    makeCollection({
      id: 10,
      name: 'Jan',
      has_dedicated_cover: true,
      slices: [
        makeSlice({ id: 100, name: 'cover', start_date: '2024-01-01', end_date: '2024-01-01' }),
        makeSlice({ id: 101, name: 'a', start_date: '2024-01-05', end_date: '2024-01-05' }),
        makeSlice({ id: 102, name: 'b', start_date: '2024-01-10', end_date: '2024-01-10' }),
      ],
    }),
    makeCollection({
      id: 11,
      name: 'Feb',
      // cover_slice_index deliberately != the first nav index (0), so
      // stepCollection's "always land on cover" and stepSlice wrap's "land
      // on first/last nav slice" rules are distinguishable in tests below.
      cover_slice_index: 1,
      has_dedicated_cover: false,
      slices: [
        makeSlice({ id: 200, name: 'c', start_date: '2024-02-01', end_date: '2024-02-01' }),
        makeSlice({ id: 201, name: 'd', start_date: '2024-02-08', end_date: '2024-02-08' }),
      ],
    }),
  ],
});

const campaign = makeCampaign({ imagery_sources: [source] });
const cat = buildCatalog(campaign);

const addr = (collectionId: number, sliceIndex: number) => ({
  sourceId: 1,
  collectionId,
  sliceIndex,
  vizId: '900',
});

describe('stepSlice', () => {
  it('advances to the next non-cover slice within a collection', () => {
    expect(stepSlice(cat, addr(10, 1), 1, {})).toEqual(addr(10, 2));
  });

  it('steps back to the previous slice', () => {
    expect(stepSlice(cat, addr(10, 2), -1, {})).toEqual(addr(10, 1));
  });

  it('skips slices marked empty', () => {
    const empties = { [emptyKey(10, 2)]: true as const };
    // From slice 1, next would be 2 but it is empty, so nothing else follows -> wraps to Feb
    expect(stepSlice(cat, addr(10, 1), 1, empties)).toEqual(addr(11, 0));
  });

  it('wraps into the neighbor collection landing on its first nav slice when stepping forward', () => {
    expect(stepSlice(cat, addr(10, 2), 1, {})).toEqual(addr(11, 0));
  });

  it('wraps into the neighbor collection landing on its last nav slice when stepping backward', () => {
    expect(stepSlice(cat, addr(11, 0), -1, {})).toEqual(addr(10, 2));
  });

  it('never lands on the dedicated cover slice while stepping', () => {
    // Jan's slice 1 stepping backward would hit the cover (index 0); since the
    // cover is excluded from nav, there is nothing earlier in Jan - no prior
    // collection exists, so stepSlice returns null.
    expect(stepSlice(cat, addr(10, 1), -1, {})).toBeNull();
  });

  it('returns null past the last collection', () => {
    expect(stepSlice(cat, addr(11, 1), 1, {})).toBeNull();
  });
});

describe('stepCollection', () => {
  // A direct Shift+A/D collection switch always lands on the target's cover
  // slice, never a within-collection nav slice. This is
  // distinct from stepSlice's end-of-collection wrap, which lands on the
  // first/last *nav* slice (see the stepSlice describe block above).

  it('moves to the next collection, landing on its cover slice (not the first nav slice)', () => {
    // Feb's cover_slice_index is 1, not 0 (the first nav index) - proves the
    // landing is the cover, not sliceNavIndices[0].
    expect(stepCollection(cat, addr(10, 1), 1, {})).toEqual(addr(11, 1));
  });

  it('moves to the previous collection, landing on its cover slice even when it is a dedicated cover', () => {
    // Jan's cover (index 0) is a dedicated cover, excluded from sliceNavIndices
    // entirely - stepCollection still lands there on a direct switch.
    expect(stepCollection(cat, addr(11, 0), -1, {})).toEqual(addr(10, 0));
  });

  it('returns null past the first/last collection', () => {
    expect(stepCollection(cat, addr(10, 0), -1, {})).toBeNull();
    expect(stepCollection(cat, addr(11, 0), 1, {})).toBeNull();
  });

  it('lands on the cover regardless of empties (empties only affect stepSlice, not a direct collection switch)', () => {
    const allEmpty = {
      [emptyKey(11, 0)]: true as const,
      [emptyKey(11, 1)]: true as const,
    };
    expect(stepCollection(cat, addr(10, 1), 1, allEmpty)).toEqual(addr(11, 1));
  });
});
