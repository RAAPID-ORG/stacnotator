import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeView,
  makeViz,
} from '~/features/annotation/core/catalog/testHelpers';
import { TilePreloader } from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../registry';
import {
  coverSliceJobs,
  PRIORITY_CURRENT,
  PRIORITY_UPCOMING,
  usePreloading,
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
  sourceIds: [1],
  around: [5, 50] as [number, number],
  zoom: 12,
  priority: 1,
};

describe('coverSliceJobs', () => {
  it('prefetches the visualization the map is actually on', () => {
    const jobs = coverSliceJobs({ ...args, active: NDVI, excludeCollectionId: 200 });
    expect(jobs.map((j) => j.urlTemplate)).toEqual(['https://t.test/ndvi/{z}/{x}/{y}.png']);
  });

  it('skips a cover slice that publishes nothing for that visualization', () => {
    // Collection 200 has no ndvi tiles: it is dropped, and the collection that
    // does have them is still queued (the builder used to throw here).
    const jobs = coverSliceJobs({ ...args, active: NDVI });
    expect(jobs.map((j) => j.groupId)).toEqual(['preload-c100-s0']);
  });

  it('falls back to the source first visualization for another source', () => {
    const jobs = coverSliceJobs({ ...args, active: null });
    expect(jobs.map((j) => j.urlTemplate)).toEqual([
      'https://t.test/rgb/{z}/{x}/{y}.png',
      'https://t.test/other/{z}/{x}/{y}.png',
    ]);
  });
});

describe('usePreloading upcoming centres', () => {
  const ctx: ComposeCtx = {
    campaign: CAMPAIGN,
    catalog: CATALOG,
    view: makeView({ id: 1, name: 'View', source_ids: [1] }),
    mode: 'tasks',
    isMobile: false,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queues the centres the caller says are coming next, behind the current one', () => {
    const enqueueMany = vi
      .spyOn(TilePreloader.prototype, 'enqueueMany')
      .mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      usePreloading(ctx, {
        enabled: true,
        focus: [5, 50],
        upcoming: [[6, 51]],
        viewportPx: [800, 600],
      })
    );

    const jobs = enqueueMany.mock.calls[0][0];
    const upcoming = jobs.filter((job) => job.priority === PRIORITY_UPCOMING);
    expect(upcoming.length).toBeGreaterThan(0);
    // The upcoming extent is around the next task's centre, not this one's.
    expect(upcoming.every((job) => job.extent[0] < 6 && job.extent[2] > 6)).toBe(true);
    expect(jobs.some((job) => job.priority === PRIORITY_CURRENT)).toBe(true);

    unmount();
  });

  it('queues only the current focus when nothing is coming next', () => {
    const enqueueMany = vi
      .spyOn(TilePreloader.prototype, 'enqueueMany')
      .mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      usePreloading(ctx, { enabled: true, focus: [5, 50], viewportPx: [800, 600] })
    );

    const jobs = enqueueMany.mock.calls[0][0];
    expect(jobs.every((job) => job.priority === PRIORITY_CURRENT)).toBe(true);

    unmount();
  });
});
