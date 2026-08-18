import { describe, it, expect } from 'vitest';
import { buildImageryCatalog } from './imagery';
import {
  makeCampaign,
  makeCollection,
  makeSource,
  makeVectorLayer,
  makeViz,
} from '../testing/fixtures';
import { cycleSource, cycleViz, rememberAddress, toggleCycle } from './imageryNav';

// ---------------------------------------------------------------------------
// toggleCycle - merges utils/customMapNav.test.ts + utils/vectorLayerNav.test.ts
// ---------------------------------------------------------------------------

interface Sel {
  id: number | null;
  visible: boolean;
}

const layer = (id: number) =>
  makeVectorLayer({
    id,
    name: `Layer ${id}`,
    pmtiles_url: `https://example.com/${id}.pmtiles`,
    color: '#3b82f6',
  });

const LAYER_1 = layer(1);
const LAYER_2 = layer(2);
const LAYER_3 = layer(3);

describe('toggleCycle - toggle action', () => {
  it('from hidden/none selects the first item and shows it', () => {
    const sel: Sel = { id: null, visible: false };
    expect(toggleCycle([LAYER_1, LAYER_2], sel, 'toggle')).toEqual({ id: 1, visible: true });
  });

  it('while shown hides without clearing the active id (re-enter guarantee)', () => {
    const sel: Sel = { id: 2, visible: true };
    expect(toggleCycle([LAYER_1, LAYER_2], sel, 'toggle')).toEqual({ id: 2, visible: false });
  });

  it('from hidden with a valid active id re-shows that same id (no reset to first)', () => {
    const sel: Sel = { id: 2, visible: false };
    expect(toggleCycle([LAYER_1, LAYER_2], sel, 'toggle')).toEqual({ id: 2, visible: true });
  });

  it('falls back to the first item when the active id is no longer valid', () => {
    const sel: Sel = { id: 999, visible: false };
    expect(toggleCycle([LAYER_1, LAYER_2], sel, 'toggle')).toEqual({ id: 1, visible: true });
  });

  it('is a no-op when there are no items', () => {
    const sel: Sel = { id: null, visible: false };
    expect(toggleCycle([], sel, 'toggle')).toBe(sel);
  });
});

describe('toggleCycle - deselect action', () => {
  it('clears the selection instead of only hiding it', () => {
    const sel: Sel = { id: 2, visible: true };
    expect(toggleCycle([LAYER_1, LAYER_2], sel, 'deselect')).toEqual({ id: null, visible: false });
  });

  it('clears a selection whose layer is gone, with no items left to match', () => {
    const sel: Sel = { id: 2, visible: false };
    expect(toggleCycle([], sel, 'deselect')).toEqual({ id: null, visible: false });
  });

  it('is a no-op when nothing is selected', () => {
    const sel: Sel = { id: null, visible: false };
    expect(toggleCycle([LAYER_1], sel, 'deselect')).toBe(sel);
  });
});

describe('toggleCycle - cycle action', () => {
  it('advances to the next item and shows it', () => {
    const sel: Sel = { id: 1, visible: false };
    expect(toggleCycle([LAYER_1, LAYER_2, LAYER_3], sel, 'cycle')).toEqual({
      id: 2,
      visible: true,
    });
  });

  it('wraps from the last item back to the first', () => {
    const sel: Sel = { id: 3, visible: true };
    expect(toggleCycle([LAYER_1, LAYER_2, LAYER_3], sel, 'cycle')).toEqual({
      id: 1,
      visible: true,
    });
  });

  it('starts at the first item when none is active', () => {
    const sel: Sel = { id: null, visible: false };
    expect(toggleCycle([LAYER_1, LAYER_2], sel, 'cycle')).toEqual({ id: 1, visible: true });
  });

  it('is a no-op when there are no items', () => {
    const sel: Sel = { id: null, visible: false };
    expect(toggleCycle([], sel, 'cycle')).toBe(sel);
  });
});

// ---------------------------------------------------------------------------
// cycleSource / cycleViz against the SliceAddress model (per-source memory is
// the lastBySource parameter).
// ---------------------------------------------------------------------------

const s2 = makeSource({
  id: 1,
  name: 'S2',
  visualizations: [
    makeViz({ id: 10, name: 'True Color' }),
    makeViz({ id: 11, name: 'False Color' }),
  ],
  collections: [
    makeCollection({ id: 100, name: 'Col100' }),
    makeCollection({ id: 101, name: 'Col101' }),
  ],
});

const vhr = makeSource({
  id: 2,
  name: 'VHR',
  display_order: 1,
  visualizations: [makeViz({ id: 20, name: 'True Color' })],
  collections: [makeCollection({ id: 200, name: 'Col200' })],
});

const view = { id: 1, name: 'V', source_ids: [1, 2] };

const addr = (sourceId: number, collectionId: number, vizId: string) => ({
  sourceId,
  collectionId,
  sliceIndex: 0,
  vizId,
});

describe('cycleSource', () => {
  it('cycles from the first source to the second source, landing on its first collection/viz', () => {
    const cat = buildImageryCatalog(makeCampaign({ imagery_sources: [s2, vhr], basemaps: [] }));
    const result = cycleSource(
      cat,
      view,
      addr(1, 100, '10'),
      { showBasemap: false, selectedBasemapId: null },
      1,
      {}
    );
    expect(result).toEqual({ kind: 'source', address: addr(2, 200, '20') });
  });

  it('cycles from the last source to the basemap', () => {
    const cat = buildImageryCatalog(
      makeCampaign({ imagery_sources: [s2, vhr], basemaps: [{ id: 5, name: 'Osm', url: 'x' }] })
    );
    const result = cycleSource(
      cat,
      view,
      addr(2, 200, '20'),
      { showBasemap: false, selectedBasemapId: null },
      1,
      {}
    );
    expect(result).toEqual({ kind: 'basemap', basemapId: 'basemap-5' });
  });

  it('cycles from the basemap back to the first source', () => {
    const cat = buildImageryCatalog(
      makeCampaign({ imagery_sources: [s2, vhr], basemaps: [{ id: 5, name: 'Osm', url: 'x' }] })
    );
    const result = cycleSource(
      cat,
      view,
      null,
      { showBasemap: true, selectedBasemapId: 'basemap-5' },
      1,
      {}
    );
    expect(result).toEqual({ kind: 'source', address: addr(1, 100, '10') });
  });

  it('returns null when there is only one ring entry', () => {
    const cat = buildImageryCatalog(makeCampaign({ imagery_sources: [s2], basemaps: [] }));
    const singleSourceView = { id: 1, name: 'V', source_ids: [1] };
    const result = cycleSource(
      cat,
      singleSourceView,
      addr(1, 100, '10'),
      { showBasemap: false, selectedBasemapId: null },
      1,
      {}
    );
    expect(result).toBeNull();
  });

  it('restores the remembered address when returning to a source after a detour', () => {
    const cat = buildImageryCatalog(makeCampaign({ imagery_sources: [s2, vhr], basemaps: [] }));
    const lastBySource = { 1: addr(1, 101, '11') };
    const result = cycleSource(
      cat,
      view,
      addr(2, 200, '20'),
      { showBasemap: false, selectedBasemapId: null },
      1,
      lastBySource
    );
    expect(result).toEqual({ kind: 'source', address: addr(1, 101, '11') });
  });

  it('ignores remembered state referencing a collection the source no longer owns', () => {
    const cat = buildImageryCatalog(makeCampaign({ imagery_sources: [s2, vhr], basemaps: [] }));
    const lastBySource = { 1: addr(1, 999, '11') };
    const result = cycleSource(
      cat,
      view,
      addr(2, 200, '20'),
      { showBasemap: false, selectedBasemapId: null },
      1,
      lastBySource
    );
    expect(result).toEqual({ kind: 'source', address: addr(1, 100, '10') });
  });

  it('never targets a source that has been dropped from the view, even with remembered state', () => {
    const cat = buildImageryCatalog(
      makeCampaign({ imagery_sources: [s2, vhr], basemaps: [{ id: 5, name: 'Osm', url: 'x' }] })
    );
    const droppedView = { id: 1, name: 'V', source_ids: [2] };
    const lastBySource = { 1: addr(1, 101, '11') };
    const result = cycleSource(
      cat,
      droppedView,
      addr(2, 200, '20'),
      { showBasemap: false, selectedBasemapId: null },
      1,
      lastBySource
    );
    expect(result).toEqual({ kind: 'basemap', basemapId: 'basemap-5' });
  });

  it('cycles backward with dir -1', () => {
    const cat = buildImageryCatalog(makeCampaign({ imagery_sources: [s2, vhr], basemaps: [] }));
    const result = cycleSource(
      cat,
      view,
      addr(1, 100, '10'),
      { showBasemap: false, selectedBasemapId: null },
      -1,
      {}
    );
    expect(result).toEqual({ kind: 'source', address: addr(2, 200, '20') });
  });
});

describe('rememberAddress', () => {
  it('records the address under its source id', () => {
    expect(rememberAddress({}, addr(1, 100, '11'))).toEqual({ 1: addr(1, 100, '11') });
  });

  it('overwrites the previous entry for the same source', () => {
    const lastBySource = { 1: addr(1, 100, '10') };
    expect(rememberAddress(lastBySource, addr(1, 101, '11'))).toEqual({ 1: addr(1, 101, '11') });
  });

  it('leaves other sources untouched', () => {
    const lastBySource = { 2: addr(2, 200, '20') };
    expect(rememberAddress(lastBySource, addr(1, 100, '11'))).toEqual({
      1: addr(1, 100, '11'),
      2: addr(2, 200, '20'),
    });
  });

  it('is a no-op when there is no address (basemap active)', () => {
    const lastBySource = { 1: addr(1, 100, '10') };
    expect(rememberAddress(lastBySource, null)).toBe(lastBySource);
  });

  it('does not mutate the input record', () => {
    const lastBySource = { 1: addr(1, 100, '10') };
    rememberAddress(lastBySource, addr(1, 101, '11'));
    expect(lastBySource).toEqual({ 1: addr(1, 100, '10') });
  });
});

describe('cycleViz', () => {
  const cat = buildImageryCatalog(makeCampaign({ imagery_sources: [s2, vhr], basemaps: [] }));

  it('advances from true color to false color within a source', () => {
    expect(cycleViz(cat, addr(1, 100, '10'), 1)).toEqual(addr(1, 100, '11'));
  });

  it('wraps from the last visualization back to the first', () => {
    expect(cycleViz(cat, addr(1, 100, '11'), 1)).toEqual(addr(1, 100, '10'));
  });

  it('returns null when the source has only one visualization', () => {
    expect(cycleViz(cat, addr(2, 200, '20'), 1)).toBeNull();
  });

  it('returns null when there is no current address (basemap active)', () => {
    expect(cycleViz(cat, null, 1)).toBeNull();
  });

  it('defaults an unknown vizId to the first position before advancing', () => {
    expect(cycleViz(cat, addr(1, 100, '999'), 1)).toEqual(addr(1, 100, '11'));
  });
});
