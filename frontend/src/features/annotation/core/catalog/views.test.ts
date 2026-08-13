import { describe, it, expect } from 'vitest';
import { buildCatalog } from './catalog';
import { makeCampaign, makeCollection, makeSource, makeViz } from './testHelpers';
import { collectionsInView, restoreSnapshot, snapshotForView } from './views';

// ---------------------------------------------------------------------------
// collectionsInView
// ---------------------------------------------------------------------------

const s1 = makeSource({
  id: 1,
  name: 'S1',
  visualizations: [makeViz({ id: 1, name: 'True Color' })],
  collections: [makeCollection({ id: 10, name: 'A' }), makeCollection({ id: 11, name: 'B' })],
});
const s2 = makeSource({
  id: 2,
  name: 'S2',
  visualizations: [makeViz({ id: 2, name: 'True Color' })],
  collections: [makeCollection({ id: 20, name: 'C' })],
});

const campaign = makeCampaign({ imagery_sources: [s1, s2] });
const cat = buildCatalog(campaign);

describe('collectionsInView', () => {
  it('flattens the view sources in stored order, then each source own collection order', () => {
    const view = { id: 1, name: 'V', source_ids: [1, 2] };
    expect(collectionsInView(cat, view).map((c) => c.id)).toEqual([10, 11, 20]);
  });

  it('drops stale source ids not present in the catalog', () => {
    const view = { id: 1, name: 'V', source_ids: [999, 2] };
    expect(collectionsInView(cat, view).map((c) => c.id)).toEqual([20]);
  });

  it('respects the view source order even when it differs from campaign order', () => {
    const view = { id: 1, name: 'V', source_ids: [2, 1] };
    expect(collectionsInView(cat, view).map((c) => c.id)).toEqual([20, 10, 11]);
  });
});

// ---------------------------------------------------------------------------
// snapshotForView / restoreSnapshot. Must include vector + basemap selection.
// ---------------------------------------------------------------------------

describe('snapshotForView', () => {
  it('picks exactly the SNAPSHOT_FIELDS, including vector and basemap selection', () => {
    const navFields = {
      address: { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1' },
      showBasemap: true,
      selectedBasemapId: 'basemap-5',
      overlay: { id: 9, visible: true },
      overlayOpacity: 0.5,
      vector: { id: 3, visible: false },
    };
    // crosshair/showAnnotations/viewSync are app-wide, not per-view - they
    // must NOT leak into the snapshot even though they're part of the state.
    const state = {
      ...navFields,
      empties: { '10:2': true as const },
      crosshair: true,
      showAnnotations: false,
      viewSync: true,
    };
    expect(snapshotForView(state)).toEqual(navFields);
  });
});

describe('restoreSnapshot', () => {
  it('returns the saved snapshot verbatim when present', () => {
    const saved = {
      address: { sourceId: 1, collectionId: 10, sliceIndex: 2, vizId: '1' },
      showBasemap: false,
      selectedBasemapId: null,
      overlay: { id: null, visible: true },
      overlayOpacity: 1,
      vector: { id: null, visible: true },
    };
    expect(restoreSnapshot(cat, saved, 20)).toBe(saved);
  });

  it('builds a fresh default snapshot at the fallback collection cover when nothing was saved', () => {
    const snap = restoreSnapshot(cat, undefined, 10);
    expect(snap.address).toEqual({ sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1' });
    expect(snap.showBasemap).toBe(false);
    expect(snap.selectedBasemapId).toBeNull();
    expect(snap.overlay).toEqual({ id: null, visible: true });
    expect(snap.overlayOpacity).toBe(1);
    expect(snap.vector).toEqual({ id: null, visible: true });
  });

  it('builds a null address when there is no fallback collection', () => {
    const snap = restoreSnapshot(cat, undefined, null);
    expect(snap.address).toBeNull();
  });
});
