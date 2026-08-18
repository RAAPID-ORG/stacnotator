import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCampaign } from '../../testing/seed';
import type { CampaignOutFull } from '~/api/client';
import { buildImageryCatalog } from '../../campaign/imagery';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { TilePreloader } from '../../map/preloader';
import { useImageryStore } from '../../stores/imagery';
import {
  PRIORITY_UPCOMING,
  taskPercents,
  usePreloading,
  visibleAddresses,
  visibleSliceJobs,
} from './usePreloading';

/** Two collections of one source, one publishing both visualizations and one only. */
const CAMPAIGN: CampaignOutFull = makeCampaign({
  imagery_sources: [
    makeSource({
      id: 1,
      name: 'Sentinel',
      visualizations: [makeViz({ id: 10, name: 'rgb' }), makeViz({ id: 11, name: 'ndvi' })],
      collections: [
        makeCollection({
          id: 100,
          name: 'Both',
          slices: [
            makeSlice({
              id: 1000,
              name: 'cover',
              tile_urls: [
                makeTileUrl({
                  visualization_name: 'rgb',
                  tile_url: 'https://t.test/rgb/{z}/{x}/{y}.png',
                }),
                makeTileUrl({
                  visualization_name: 'ndvi',
                  tile_url: 'https://t.test/ndvi/{z}/{x}/{y}.png',
                }),
              ],
            }),
          ],
        }),
        makeCollection({
          id: 200,
          name: 'Rgb only',
          slices: [
            makeSlice({
              id: 2000,
              name: 'cover',
              tile_urls: [
                makeTileUrl({
                  visualization_name: 'rgb',
                  tile_url: 'https://t.test/other/{z}/{x}/{y}.png',
                }),
              ],
            }),
            makeSlice({
              id: 2001,
              name: 'later',
              tile_urls: [
                makeTileUrl({
                  visualization_name: 'rgb',
                  tile_url: 'https://t.test/other-later/{z}/{x}/{y}.png',
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
});

const CATALOG = buildImageryCatalog(CAMPAIGN);
const NDVI = { sourceId: 1, collectionId: 100, sliceIndex: 0, vizId: '11' };

const args = {
  catalog: CATALOG,
  addresses: [NDVI],
  around: [5, 50] as [number, number],
  fallbackZoom: 12,
  priority: 1,
  taskIndex: 0,
};

describe('taskPercents', () => {
  it('aggregates every group belonging to a task into one percentage', () => {
    const progress = new Map([
      ['preload-t0-c100-s0', { done: 2, total: 4 }],
      ['preload-t0-c200-s0', { done: 4, total: 4 }],
      ['preload-t1-c100-s0', { done: 0, total: 8 }],
    ]);
    expect(taskPercents(progress, 2)).toEqual([75, 0]);
  });

  it('reads a task with nothing queued as not started', () => {
    expect(taskPercents(new Map(), 3)).toEqual([0, 0, 0]);
  });

  it('ignores groups beyond the tasks being shown', () => {
    const progress = new Map([['preload-t2-c100-s0', { done: 1, total: 1 }]]);
    expect(taskPercents(progress, 1)).toEqual([0]);
  });
});

describe('visibleSliceJobs', () => {
  beforeEach(() => useImageryStore.setState({ windowSlices: {}, viewSync: true }));

  it('prefetches the exact visualization and date currently visible', () => {
    const jobs = visibleSliceJobs(args);
    expect(jobs.map((j) => j.urlTemplate)).toEqual(['https://t.test/ndvi/{z}/{x}/{y}.png']);
  });

  it('never expands the job set to hidden collections in the catalog', () => {
    const addresses = visibleAddresses(CATALOG, NDVI, [], {}, true);
    expect(addresses).toEqual([NDVI]);
    expect(visibleSliceJobs({ ...args, addresses })).toHaveLength(1);
  });

  it('adds one exact address for each visible imagery window', () => {
    expect(visibleAddresses(CATALOG, NDVI, [100, 200], {}, true)).toEqual([
      NDVI,
      { sourceId: 1, collectionId: 200, sliceIndex: 0, vizId: '10' },
    ]);
  });

  it('uses a window selected date instead of preloading its cover', () => {
    useImageryStore.getState().rememberWindowSlice(200, 1, true);

    const addresses = visibleAddresses(
      CATALOG,
      NDVI,
      [200],
      useImageryStore.getState().windowSlices,
      true
    );
    expect(addresses).toEqual([
      NDVI,
      { sourceId: 1, collectionId: 200, sliceIndex: 1, vizId: '10' },
    ]);
    expect(visibleSliceJobs({ ...args, addresses }).map((job) => job.urlTemplate)).toEqual([
      'https://t.test/ndvi/{z}/{x}/{y}.png',
      'https://t.test/other-later/{z}/{x}/{y}.png',
    ]);
  });

  it('does not preload unsynchronised background windows at the next task', () => {
    expect(visibleAddresses(CATALOG, NDVI, [100, 200], {}, false)).toEqual([NDVI]);
  });
});

describe('usePreloading upcoming centres', () => {
  beforeEach(() => seedCampaign(CAMPAIGN, { mode: 'tasks' }));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useImageryStore.setState({ address: NDVI, windowSlices: {}, viewSync: true });
  });

  it('queues only the visible imagery at centres the caller says are coming next', () => {
    const enqueueMany = vi
      .spyOn(TilePreloader.prototype, 'enqueueMany')
      .mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      usePreloading({
        enabled: true,
        activeLoading: false,
        focus: [5, 50],
        upcoming: [[6, 51]],
        viewportPx: [800, 600],
        visibleCollectionIds: [100, 200],
      })
    );

    const jobs = enqueueMany.mock.calls[0][0];
    const upcoming = jobs.filter((job) => job.priority === PRIORITY_UPCOMING);
    expect(upcoming.length).toBeGreaterThan(0);
    // The upcoming extent is around the next task's centre, not this one's.
    expect(upcoming.every((job) => job.extent[0] < 6 && job.extent[2] > 6)).toBe(true);
    expect(jobs.every((job) => job.priority === PRIORITY_UPCOMING)).toBe(true);

    unmount();
  });

  it('gives each upcoming task its own groups so progress reads per task', () => {
    const enqueueMany = vi
      .spyOn(TilePreloader.prototype, 'enqueueMany')
      .mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      usePreloading({
        enabled: true,
        activeLoading: false,
        focus: [5, 50],
        upcoming: [
          [6, 51],
          [7, 52],
        ],
        viewportPx: [800, 600],
        visibleCollectionIds: [100, 200],
      })
    );

    expect(enqueueMany.mock.calls[0][0].map((job) => job.groupId)).toEqual([
      'preload-t0-c100-s0',
      'preload-t0-c200-s0',
      'preload-t1-c100-s0',
      'preload-t1-c200-s0',
    ]);

    unmount();
  });

  it('survives a reflow that nudges the viewport within the same tile span', () => {
    const enqueueMany = vi
      .spyOn(TilePreloader.prototype, 'enqueueMany')
      .mockImplementation(() => {});

    const { rerender, unmount } = renderHook(
      ({ viewportPx }) =>
        usePreloading({
          enabled: true,
          activeLoading: false,
          focus: [5, 50],
          upcoming: [[6, 51]],
          viewportPx,
          visibleCollectionIds: [100, 200],
        }),
      { initialProps: { viewportPx: [800, 600] as [number, number] } }
    );
    expect(enqueueMany).toHaveBeenCalledTimes(1);

    rerender({ viewportPx: [800.4, 600.2] });

    expect(enqueueMany).toHaveBeenCalledTimes(1);

    rerender({ viewportPx: [1100, 600] });
    expect(enqueueMany).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('keeps the warm set while the user browses imagery at the same task', () => {
    vi.spyOn(TilePreloader.prototype, 'enqueueMany').mockImplementation(() => {});
    const clearCache = vi.spyOn(TilePreloader.prototype, 'clearCache');

    const { rerender, unmount } = renderHook(
      ({ focus }) =>
        usePreloading({
          enabled: true,
          activeLoading: false,
          focus,
          upcoming: [[6, 51]],
          viewportPx: [800, 600],
          visibleCollectionIds: [100, 200],
        }),
      { initialProps: { focus: [5, 50] as [number, number] } }
    );
    expect(clearCache).toHaveBeenCalledTimes(1);

    act(() => useImageryStore.setState({ address: { ...NDVI, vizId: '10' } }));

    expect(clearCache).toHaveBeenCalledTimes(1);

    rerender({ focus: [9, 40] });
    expect(clearCache).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('queues nothing when nothing is coming next because visible maps own the current focus', () => {
    const enqueueMany = vi
      .spyOn(TilePreloader.prototype, 'enqueueMany')
      .mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      usePreloading({
        enabled: true,
        activeLoading: false,
        focus: [5, 50],
        viewportPx: [800, 600],
        visibleCollectionIds: [100, 200],
      })
    );

    expect(enqueueMany).not.toHaveBeenCalled();

    unmount();
  });

  it('pauses speculative requests until the foreground map is idle', () => {
    const pause = vi.spyOn(TilePreloader.prototype, 'pause');
    const resume = vi.spyOn(TilePreloader.prototype, 'resume');
    const enqueueMany = vi
      .spyOn(TilePreloader.prototype, 'enqueueMany')
      .mockImplementation(() => {});

    const { rerender, unmount } = renderHook(
      ({ activeLoading }) =>
        usePreloading({
          enabled: true,
          activeLoading,
          focus: [5, 50],
          upcoming: [[6, 51]],
          viewportPx: [800, 600],
          visibleCollectionIds: [100, 200],
        }),
      { initialProps: { activeLoading: true } }
    );

    expect(pause).toHaveBeenCalled();
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(enqueueMany.mock.invocationCallOrder[0]);
    rerender({ activeLoading: false });
    expect(resume).toHaveBeenCalled();

    unmount();
  });
});
