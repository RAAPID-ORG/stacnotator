import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCampaign } from '../../testing/seed';
import type { CampaignOutFull } from '~/api/client';
import { buildCatalog } from '../../campaign/catalog';
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

const CATALOG = buildCatalog(CAMPAIGN);
const NDVI = { sourceId: 1, collectionId: 100, sliceIndex: 0, vizId: '11' };

const args = {
  catalog: CATALOG,
  addresses: [NDVI],
  around: [5, 50] as [number, number],
  fallbackZoom: 12,
  priority: 1,
};

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
