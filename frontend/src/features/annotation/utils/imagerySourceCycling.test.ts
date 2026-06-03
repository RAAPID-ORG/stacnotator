import { describe, it, expect } from 'vitest';
import {
  buildSourceGroups,
  computeCycleSource,
  computeCycleVisualization,
} from './imagerySourceCycling';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const s2 = {
  id: 1,
  visualizations: [{ name: 'True Color' }, { name: 'False Color' }],
  collections: [{ id: 10 }, { id: 11 }],
};

const vhr = {
  id: 2,
  visualizations: [{ name: 'True Color' }],
  collections: [{ id: 20 }],
};

const sources = [s2, vhr];

const view = {
  collection_refs: [
    { collection_id: 10, source_id: 1 },
    { collection_id: 20, source_id: 2 },
  ],
};

// s2: startIdx=0, count=2  (indices 0=True Color, 1=False Color)
// vhr: startIdx=2, count=1 (index 2)
const sourceGroups = buildSourceGroups(sources, new Set([1, 2]));

const basemapIds = ['basemap-1'];

const defaultState = {
  selectedLayerIndex: 0,
  showBasemap: false,
  activeCollectionId: 10,
  selectedBasemapId: null,
  lastSourceState: {} as Record<number, { collectionId: number; layerIndex: number }>,
};

// ---------------------------------------------------------------------------
// buildSourceGroups
// ---------------------------------------------------------------------------

describe('buildSourceGroups', () => {
  it('assigns contiguous indices across all sources', () => {
    const groups = buildSourceGroups(sources, new Set([1, 2]));
    expect(groups).toEqual([
      { id: 1, startIdx: 0, count: 2 },
      { id: 2, startIdx: 2, count: 1 },
    ]);
  });

  it('skips sources not in the view and offsets correctly', () => {
    const groups = buildSourceGroups(sources, new Set([2]));
    // s2 is skipped but its 2 visualizations still advance the offset
    expect(groups).toEqual([{ id: 2, startIdx: 2, count: 1 }]);
  });

  it('includes all sources when viewSourceIds is empty', () => {
    const groups = buildSourceGroups(sources, new Set());
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ id: 1, startIdx: 0 });
    expect(groups[1]).toMatchObject({ id: 2, startIdx: 2 });
  });
});

// ---------------------------------------------------------------------------
// computeCycleSource - basic cycling
// ---------------------------------------------------------------------------

describe('computeCycleSource - source cycling', () => {
  it('cycles from first source to second source', () => {
    const result = computeCycleSource(sourceGroups, basemapIds, sources, view, defaultState);
    expect(result).toMatchObject({ action: 'switch-to-source', layerIndex: 2, collectionId: 20 });
  });

  it('cycles from last source to the basemap', () => {
    const state = { ...defaultState, selectedLayerIndex: 2, activeCollectionId: 20 };
    const result = computeCycleSource(sourceGroups, basemapIds, sources, view, state);
    expect(result).toMatchObject({ action: 'switch-to-basemap', basemapId: 'basemap-1' });
  });

  it('cycles from basemap back to the first source', () => {
    const state = {
      ...defaultState,
      showBasemap: true,
      selectedBasemapId: 'basemap-1',
      activeCollectionId: null,
    };
    const result = computeCycleSource(sourceGroups, basemapIds, sources, view, state);
    expect(result).toMatchObject({ action: 'switch-to-source', collectionId: 10 });
  });

  it('returns noop when there is only one entry', () => {
    const singleGroup = buildSourceGroups([s2], new Set([1]));
    const result = computeCycleSource(singleGroup, [], [s2], view, defaultState);
    expect(result).toEqual({ action: 'noop' });
  });
});

// ---------------------------------------------------------------------------
// computeCycleSource - state recording
// ---------------------------------------------------------------------------

describe('computeCycleSource - records current source state before switching', () => {
  it('records the current layer index when leaving a source', () => {
    const result = computeCycleSource(sourceGroups, basemapIds, sources, view, defaultState);
    expect(result.action).toBe('switch-to-source');
    expect(result).toMatchObject({
      recordState: { sourceId: 1, collectionId: 10, layerIndex: 0 },
    });
  });

  it('records false-color index when leaving S2 while on false color', () => {
    const state = { ...defaultState, selectedLayerIndex: 1 }; // index 1 = false color
    const result = computeCycleSource(sourceGroups, basemapIds, sources, view, state);
    expect(result).toMatchObject({
      recordState: { sourceId: 1, collectionId: 10, layerIndex: 1 },
    });
  });

  it('does not record state when leaving the basemap', () => {
    const state = {
      ...defaultState,
      showBasemap: true,
      selectedBasemapId: 'basemap-1',
      activeCollectionId: null,
    };
    const result = computeCycleSource(sourceGroups, basemapIds, sources, view, state);
    expect(result.action).toBe('switch-to-source');
    if (result.action === 'switch-to-source') {
      expect(result.recordState).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// computeCycleSource - visualization restoration
// ---------------------------------------------------------------------------

describe('computeCycleSource - restores visualization on return', () => {
  it('restores false-color layer index when returning to S2 after VHR detour', () => {
    // Simulate: user set false color (index 1) on S2, cycled to VHR, now cycling back
    const stateOnVhr = {
      ...defaultState,
      selectedLayerIndex: 2,
      activeCollectionId: 20,
      lastSourceState: { [s2.id]: { collectionId: 10, layerIndex: 1 } },
    };
    const result = computeCycleSource(sourceGroups, [], sources, view, stateOnVhr);
    expect(result).toMatchObject({ action: 'switch-to-source', layerIndex: 1, collectionId: 10 });
  });

  it('uses startIdx (true color) when there is no remembered state for the target', () => {
    const state = { ...defaultState, selectedLayerIndex: 2, activeCollectionId: 20 };
    const noBasemaps: string[] = [];
    // Only two sources, no basemap - cycles S2 → VHR → S2
    const result = computeCycleSource(sourceGroups, noBasemaps, sources, view, state);
    expect(result).toMatchObject({ action: 'switch-to-source', layerIndex: 0 });
  });

  it('does not restore remembered state from a collection not in the view', () => {
    // lastSourceState references collectionId 99, which is not in selectedView.collection_refs
    const stateOnVhr = {
      ...defaultState,
      selectedLayerIndex: 2,
      activeCollectionId: 20,
      lastSourceState: { [s2.id]: { collectionId: 99, layerIndex: 1 } },
    };
    const result = computeCycleSource(sourceGroups, [], sources, view, stateOnVhr);
    // Falls back to startIdx since the remembered collection is not accessible
    expect(result).toMatchObject({ action: 'switch-to-source', layerIndex: 0 });
  });

  it('restores the remembered collection id alongside the layer index', () => {
    // s2 has two collections (10 and 11). User was on collection 11 at false color (index 1).
    const viewWithBothCollections = {
      collection_refs: [
        { collection_id: 10, source_id: 1 },
        { collection_id: 11, source_id: 1 },
        { collection_id: 20, source_id: 2 },
      ],
    };
    const stateOnVhr = {
      ...defaultState,
      selectedLayerIndex: 2,
      activeCollectionId: 20,
      lastSourceState: { [s2.id]: { collectionId: 11, layerIndex: 1 } },
    };
    const result = computeCycleSource(
      sourceGroups,
      [],
      sources,
      viewWithBothCollections,
      stateOnVhr
    );
    expect(result).toMatchObject({ action: 'switch-to-source', layerIndex: 1, collectionId: 11 });
  });
});

// ---------------------------------------------------------------------------
// computeCycleVisualization
// ---------------------------------------------------------------------------

describe('computeCycleVisualization', () => {
  it('advances from true color (0) to false color (1) within S2', () => {
    const next = computeCycleVisualization(sourceGroups, sources, 0, 10, false);
    expect(next).toBe(1);
  });

  it('wraps from false color (1) back to true color (0)', () => {
    const next = computeCycleVisualization(sourceGroups, sources, 1, 10, false);
    expect(next).toBe(0);
  });

  it('returns null when the active source has only one visualization', () => {
    const next = computeCycleVisualization(sourceGroups, sources, 2, 20, false);
    expect(next).toBeNull();
  });

  it('returns null when the basemap is active', () => {
    const next = computeCycleVisualization(sourceGroups, sources, 0, 10, true);
    expect(next).toBeNull();
  });

  it('returns null when activeCollectionId matches no source', () => {
    const next = computeCycleVisualization(sourceGroups, sources, 0, 999, false);
    expect(next).toBeNull();
  });

  it('clamps an out-of-range selectedLayerIndex to the last viz then advances', () => {
    // selectedLayerIndex way beyond S2's range (0–1): clamps to 1, then wraps to 0
    const next = computeCycleVisualization(sourceGroups, sources, 99, 10, false);
    expect(next).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Full round-trip: shift-I, I to VHR, I back to S2 restores false color
// ---------------------------------------------------------------------------

describe('full round-trip: false color survives a source detour', () => {
  it('S2 false color → VHR → back to S2 restores false color', () => {
    // Step 1: User is on S2 true color (index 0), presses shift-I → false color (index 1)
    const afterFalseColor = computeCycleVisualization(sourceGroups, sources, 0, 10, false);
    expect(afterFalseColor).toBe(1);

    // Step 2: User presses I to leave S2 (currently at false color = index 1)
    const s2FalseColorState = {
      ...defaultState,
      selectedLayerIndex: 1,
      activeCollectionId: 10,
      lastSourceState: {},
    };
    const toVhr = computeCycleSource(sourceGroups, [], sources, view, s2FalseColorState);
    expect(toVhr).toMatchObject({ action: 'switch-to-source', layerIndex: 2 });
    expect(toVhr.action === 'switch-to-source' && toVhr.recordState).toMatchObject({
      sourceId: 1,
      layerIndex: 1,
    });

    // Step 3: Apply VHR state and recorded S2 state
    const stateOnVhr = {
      ...defaultState,
      selectedLayerIndex: 2,
      activeCollectionId: 20,
      lastSourceState: { [s2.id]: { collectionId: 10, layerIndex: 1 } },
    };

    // Step 4: User presses I again to return to S2
    const backToS2 = computeCycleSource(sourceGroups, [], sources, view, stateOnVhr);
    expect(backToS2).toMatchObject({ action: 'switch-to-source', layerIndex: 1, collectionId: 10 });
  });
});
