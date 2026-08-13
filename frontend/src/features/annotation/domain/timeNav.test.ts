import { describe, it, expect } from 'vitest';
import { buildCatalog } from './catalog';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeViz,
} from '../testing/fixtures';
import { emptyKey } from './catalog';
import {
  addressAtSlice,
  collectionAddress,
  sliceNavIndices,
  slicePickerIndices,
  stepCollectionId,
  stepSlice,
} from './imageryNav';

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

describe('stepCollectionId', () => {
  it('finds the next collection in chronological order', () => {
    expect(stepCollectionId(cat, addr(10, 1), 1)).toBe(11);
  });

  it('finds the previous collection', () => {
    expect(stepCollectionId(cat, addr(11, 0), -1)).toBe(10);
  });

  it('returns null past the first/last collection', () => {
    expect(stepCollectionId(cat, addr(10, 0), -1)).toBeNull();
    expect(stepCollectionId(cat, addr(11, 0), 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Visualization carried across navigation, with a publish-check fallback.
// Chronologically: Jan (both viz) -> Feb (both viz) -> Mar (True Color only).
// Stepping/jumping Jan -> Feb keeps False Color; Feb -> Mar falls back.
// ---------------------------------------------------------------------------

const trueColor = makeTileUrl({ visualization_name: 'True Color' });
const falseColor = makeTileUrl({ visualization_name: 'False Color' });

const mvSource = makeSource({
  id: 1,
  name: 'S',
  visualizations: [
    makeViz({ id: 900, name: 'True Color' }),
    makeViz({ id: 901, name: 'False Color' }),
  ],
  collections: [
    makeCollection({
      id: 10,
      name: 'Jan',
      slices: [
        makeSlice({
          id: 100,
          name: 'a',
          start_date: '2024-01-01',
          end_date: '2024-01-01',
          tile_urls: [trueColor, falseColor],
        }),
        makeSlice({
          id: 101,
          name: 'b',
          start_date: '2024-01-05',
          end_date: '2024-01-05',
          tile_urls: [trueColor, falseColor],
        }),
      ],
    }),
    makeCollection({
      id: 12,
      name: 'Feb',
      slices: [
        makeSlice({
          id: 120,
          name: 'c',
          start_date: '2024-02-01',
          end_date: '2024-02-01',
          tile_urls: [trueColor, falseColor],
        }),
      ],
    }),
    makeCollection({
      id: 11,
      name: 'Mar',
      slices: [
        makeSlice({
          id: 110,
          name: 'd',
          start_date: '2024-03-01',
          end_date: '2024-03-01',
          tile_urls: [trueColor],
        }),
      ],
    }),
  ],
});
const mvCampaign = makeCampaign({ imagery_sources: [mvSource] });
const mvCat = buildCatalog(mvCampaign);
const mvAddr = (collectionId: number, sliceIndex: number, vizId: string) => ({
  sourceId: 1,
  collectionId,
  sliceIndex,
  vizId,
});

describe('visualization carried across navigation', () => {
  it('a direct date pick keeps the visualization when the target publishes it', () => {
    expect(addressAtSlice(mvCat, mvAddr(10, 0, '901'), 1)).toEqual(mvAddr(10, 1, '901'));
  });

  it('a direct cover pick falls back to a visualization that cover actually publishes', () => {
    const falseOnlyCover = makeSource({
      id: 3,
      visualizations: [
        makeViz({ id: 30, name: 'True Color' }),
        makeViz({ id: 31, name: 'False Color' }),
      ],
      collections: [
        makeCollection({
          id: 30,
          slices: [
            makeSlice({
              id: 300,
              tile_urls: [makeTileUrl({ visualization_name: 'False Color' })],
            }),
          ],
        }),
      ],
    });
    const directCat = buildCatalog(makeCampaign({ imagery_sources: [falseOnlyCover] }));

    expect(
      addressAtSlice(directCat, { sourceId: 3, collectionId: 30, sliceIndex: 0, vizId: '30' }, 0)
    ).toEqual({ sourceId: 3, collectionId: 30, sliceIndex: 0, vizId: '31' });
  });

  it('stepSlice keeps False Color across a slice step within the collection', () => {
    expect(stepSlice(mvCat, mvAddr(10, 0, '901'), 1, {})).toEqual(mvAddr(10, 1, '901'));
  });

  it('collectionAddress keeps the current visualization within the same source', () => {
    expect(collectionAddress(mvCat, 12, mvAddr(10, 0, '901'))).toEqual(mvAddr(12, 0, '901'));
  });

  it('collectionAddress uses an explicit remembered slice instead of the cover', () => {
    expect(collectionAddress(mvCat, 10, mvAddr(12, 0, '901'), 1)).toEqual(mvAddr(10, 1, '901'));
  });

  it('collectionAddress falls back when the target does not publish the current visualization', () => {
    expect(collectionAddress(mvCat, 11, mvAddr(12, 0, '901'))).toEqual(mvAddr(11, 0, '900'));
  });

  it('collectionAddress resets to the target source default when switching sources', () => {
    const other = makeSource({
      id: 2,
      name: 'Other',
      visualizations: [makeViz({ id: 20, name: 'True Color' })],
      collections: [makeCollection({ id: 300, name: 'C', slices: [makeSlice({ id: 3000 })] })],
    });
    const multiSourceCat = buildCatalog(makeCampaign({ imagery_sources: [mvSource, other] }));
    expect(collectionAddress(multiSourceCat, 300, mvAddr(10, 0, '901'))).toEqual({
      sourceId: 2,
      collectionId: 300,
      sliceIndex: 0,
      vizId: '20',
    });
  });

  it('collectionAddress returns null for an unknown collection', () => {
    expect(collectionAddress(mvCat, 999, null)).toBeNull();
  });
});
