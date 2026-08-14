import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageryCollectionOut } from '~/api/client';
import { buildCatalog, emptyKey, type Empties } from '../../campaign/catalog';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import {
  candidateOrder,
  nextProbe,
  healingEnabled,
  shouldHeal,
  startProbe,
  useEmptyHealing,
  type ProbeCandidate,
} from './useEmptyHealing';

function collection(
  sliceCount: number,
  overrides: Partial<ImageryCollectionOut> = {}
): ImageryCollectionOut {
  return makeCollection({
    id: 1,
    name: 'Test',
    slices: Array.from({ length: sliceCount }, (_, i) =>
      makeSlice({ id: i + 1, name: `s${i}`, display_order: i })
    ),
    ...overrides,
  });
}

const cand = (index: number): ProbeCandidate => ({ index, label: `s${index}` });

describe('candidateOrder', () => {
  it('orders forward from the current index, then backward, then the rest', () => {
    const col = collection(6);
    expect(candidateOrder(col, {}, 2)).toEqual([3, 4, 5, 1, 0]);
  });

  it('skips a dedicated cover slice, which never participates in navigation', () => {
    const col = collection(4, { cover_slice_index: 0, has_dedicated_cover: true });
    // nav indices are 1,2,3 (0 is the dedicated cover); current=2 -> forward [3], backward [1] -> rest is [0]
    expect(candidateOrder(col, {}, 2)).toEqual([3, 1, 0]);
  });

  it('never retries a slice already known empty', () => {
    const col = collection(5);
    const empties: Empties = { [emptyKey(1, 3)]: true };
    // current=1 -> nav=[0,1,2,4] (3 excluded); forward [2,4]; backward [0]; rest empty (3 is known-empty)
    expect(candidateOrder(col, empties, 1)).toEqual([2, 4, 0]);
  });
});

describe('startProbe', () => {
  it('seeds a searching state with the current index pre-marked empty', () => {
    const state = startProbe(2, [cand(3), cand(4)]);
    expect(state).toEqual({
      phase: 'searching',
      queue: [cand(3), cand(4)],
      emptyIndices: [2],
      resolvedIndex: null,
    });
  });

  it('goes straight to no-data when there are no candidates left to try', () => {
    const state = startProbe(2, []);
    expect(state).toEqual({ phase: 'no-data', queue: [], emptyIndices: [2], resolvedIndex: null });
  });
});

describe('nextProbe', () => {
  it('commits on the first non-empty result', () => {
    const seeded = startProbe(0, [cand(1), cand(2)]);
    const afterFirst = nextProbe(seeded, true);
    expect(afterFirst.phase).toBe('searching');
    expect(afterFirst.emptyIndices).toEqual([0, 1]);

    const afterSecond = nextProbe(afterFirst, false);
    expect(afterSecond).toEqual({
      phase: 'found',
      queue: [],
      emptyIndices: [0, 1],
      resolvedIndex: 2,
    });
  });

  it('walks the whole queue in order before committing', () => {
    let state = startProbe(0, [cand(1), cand(2), cand(3)]);
    state = nextProbe(state, true); // 1 empty
    expect(state.queue[0]).toEqual(cand(2));
    state = nextProbe(state, false); // 2 has imagery
    expect(state).toMatchObject({ phase: 'found', resolvedIndex: 2 });
  });

  it('exhausts to no-data when every candidate is empty', () => {
    let state = startProbe(0, [cand(1), cand(2)]);
    state = nextProbe(state, true);
    expect(state.phase).toBe('searching');
    state = nextProbe(state, true);
    expect(state).toEqual({
      phase: 'no-data',
      queue: [],
      emptyIndices: [0, 1, 2],
      resolvedIndex: null,
    });
  });

  it('is a no-op once resolved, so a late result cannot resurrect a finished search', () => {
    const found = { phase: 'found' as const, queue: [], emptyIndices: [0], resolvedIndex: 1 };
    expect(nextProbe(found, true)).toBe(found);
    expect(nextProbe(found, false)).toBe(found);

    const noData = {
      phase: 'no-data' as const,
      queue: [],
      emptyIndices: [0, 1],
      resolvedIndex: null,
    };
    expect(nextProbe(noData, false)).toBe(noData);
  });

  it('is a no-op on an idle state (nothing queued)', () => {
    const idle = { phase: 'idle' as const, queue: [], emptyIndices: [], resolvedIndex: null };
    expect(nextProbe(idle, true)).toBe(idle);
  });
});

describe('shouldHeal', () => {
  it('is true while following (viewSync), even if not the active collection', () => {
    expect(shouldHeal(true, false)).toBe(true);
  });

  it('is true while active, even without view sync', () => {
    expect(shouldHeal(false, true)).toBe(true);
  });

  it('is false for a drifted background window - neither following nor active', () => {
    expect(shouldHeal(false, false)).toBe(false);
  });
});

describe('healingEnabled', () => {
  const gate = (over: Partial<Parameters<typeof healingEnabled>[0]> = {}) =>
    healingEnabled({
      viewSync: true,
      isActive: true,
      sliceIndex: 2,
      userPickedIndex: null,
      ...over,
    });

  it('heals a slice the window arrived at by itself', () => {
    expect(gate()).toBe(true);
  });

  it('leaves the slice the user picked by hand alone, empty or not', () => {
    expect(gate({ userPickedIndex: 2 })).toBe(false);
  });

  it('resumes once navigation moves the window off that pick', () => {
    expect(gate({ sliceIndex: 3, userPickedIndex: 2 })).toBe(true);
  });

  it('still refuses to probe a window that is not tracking the main camera', () => {
    expect(gate({ viewSync: false, isActive: false })).toBe(false);
  });
});

describe('useEmptyHealing enabled gate', () => {
  const CAMPAIGN = makeCampaign({
    imagery_sources: [
      makeSource({
        id: 1,
        name: 'Sentinel',
        visualizations: [makeViz({ id: 11, name: 'rgb' })],
        collections: [
          makeCollection({
            id: 100,
            name: 'Only',
            slices: [
              makeSlice({
                id: 1000,
                name: 's0',
                tile_urls: [
                  makeTileUrl({
                    visualization_name: 'rgb',
                    tile_url: 'https://t.test/{z}/{x}/{y}.png',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const CATALOG = buildCatalog(CAMPAIGN);
  const COLLECTION = CATALOG.collections.get(100)!;
  const ADDRESS = { sourceId: 1, collectionId: 100, sliceIndex: 0, vizId: '11' };

  const baseArgs = (enabled: boolean) => ({
    catalog: CATALOG,
    collection: COLLECTION,
    address: ADDRESS,
    enabled,
    getPoint: () => [0, 0] as [number, number],
    zoom: 10,
    empties: {},
    markEmpty: vi.fn(),
    onResolved: vi.fn(),
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never probes a drifted background window (enabled=false)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useEmptyHealing(baseArgs(false)));

    // Nothing to await on success (there's no request to wait for) - give a
    // tick for any stray microtask, then assert the network was never touched.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes a following/active window (enabled=true)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useEmptyHealing(baseArgs(true)));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('does not call a transient server failure no-data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const args = baseArgs(true);

    const { result } = renderHook(() => useEmptyHealing(args));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.noImagery).toBe(false);
    expect(args.markEmpty).not.toHaveBeenCalled();
  });

  it('calls only an explicit no-content response no-data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const args = baseArgs(true);

    const { result } = renderHook(() => useEmptyHealing(args));

    await waitFor(() => expect(result.current.noImagery).toBe(true));
    expect(args.markEmpty).toHaveBeenCalledWith(100, 0);
  });
});
