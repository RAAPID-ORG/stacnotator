import { describe, expect, it } from 'vitest';
import { makeCampaign, makeCollection, makeSlice, makeSource } from '../testing/fixtures';
import { buildImageryCatalog } from './imagery';
import {
  addressOfSlice,
  describeSlice,
  listNotes,
  sliceCommentAt,
  toNotes,
  withNote,
} from './sliceComments';

const catalog = buildImageryCatalog(
  makeCampaign({
    imagery_sources: [
      makeSource({
        id: 1,
        name: 'Sentinel-2',
        collections: [
          makeCollection({
            id: 10,
            slices: [
              makeSlice({ id: 100, start_date: '2024-06-01', end_date: '2024-06-07' }),
              makeSlice({ id: 101, start_date: '2024-05-01', end_date: '2024-05-07' }),
            ],
          }),
        ],
      }),
    ],
  })
);

const address = { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '' };

describe('sliceCommentAt', () => {
  it('snapshots the imagery the note is about', () => {
    expect(sliceCommentAt(catalog, address, 'cloudy')).toEqual({
      slice_id: 100,
      text: 'cloudy',
      source_name: 'Sentinel-2',
      start_date: '2024-06-01',
      end_date: '2024-06-07',
    });
  });

  it('is null for a slice the catalog no longer has', () => {
    expect(sliceCommentAt(catalog, { ...address, sliceIndex: 9 }, 'cloudy')).toBeNull();
  });
});

describe('withNote', () => {
  it('replaces the note on a slice rather than adding a second', () => {
    const first = withNote({}, sliceCommentAt(catalog, address, 'cloudy')!);
    const second = withNote(first, sliceCommentAt(catalog, address, 'clear')!);
    expect(listNotes(second)).toHaveLength(1);
    expect(listNotes(second)[0].text).toBe('clear');
  });

  it('removes the note when the text is blanked', () => {
    const notes = withNote({}, sliceCommentAt(catalog, address, 'cloudy')!);
    expect(listNotes(withNote(notes, sliceCommentAt(catalog, address, '  ')!))).toEqual([]);
  });
});

describe('listNotes', () => {
  it('orders by the imagery date, not by when they were written', () => {
    const notes = withNote(
      withNote({}, sliceCommentAt(catalog, address, 'june')!),
      sliceCommentAt(catalog, { ...address, sliceIndex: 1 }, 'may')!
    );
    expect(listNotes(notes).map((n) => n.text)).toEqual(['may', 'june']);
  });
});

describe('toNotes', () => {
  it('round-trips a stored annotation', () => {
    const stored = [sliceCommentAt(catalog, address, 'cloudy')!];
    expect(listNotes(toNotes(stored))).toEqual(stored);
  });

  it('treats a missing list as no notes', () => {
    expect(toNotes(null)).toEqual({});
  });
});

describe('describeSlice', () => {
  it('names the source and the date range', () => {
    expect(describeSlice(sliceCommentAt(catalog, address, 'cloudy')!)).toBe(
      'Sentinel-2, Jun 1, 2024 - Jun 7, 2024'
    );
  });

  it('falls back to the slice id when nothing was snapshotted', () => {
    expect(describeSlice({ slice_id: 7, text: 'x' })).toBe('Slice 7');
  });
});

describe('addressOfSlice', () => {
  it('finds the slice a note is about, wherever it sits in the catalog', () => {
    expect(addressOfSlice(catalog, 101)).toMatchObject({
      sourceId: 1,
      collectionId: 10,
      sliceIndex: 1,
    });
  });

  it('is null for a slice the catalog no longer has', () => {
    expect(addressOfSlice(catalog, 999)).toBeNull();
  });
});
