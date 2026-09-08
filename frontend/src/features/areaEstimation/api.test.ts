import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { JobOut, MapOut } from '~/api/client';
import { censusPixels, inspectRaster, listPlannedTaskSets, loadPlan, savePlan } from './api';
import { WHOLE_MAP_AREA_ID, emptyPlan, proposedEqualAreaCrs } from './core/plan';

const sdk = vi.hoisted(() => ({
  uploadMap: vi.fn(),
  linkMap: vi.fn(),
  setAreas: vi.fn(),
  preprocess: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock('~/api/client/sdk.gen', () => sdk);

const mapOut = (overrides: Partial<MapOut['info']['sources'][number]> = {}): MapOut => ({
  id: 'abc',
  created_at: '2026-09-08T00:00:00Z',
  sources: [{ kind: 'upload', name: 'crop.tif', location: '00-crop.tif' }],
  info: {
    sources: [
      {
        name: 'crop.tif',
        width: 10,
        height: 10,
        crs: 'EPSG:4326',
        crs_name: 'WGS 84',
        is_geographic: true,
        is_equal_area: false,
        resolution: [0.001, 0.001],
        pixel_area_m2: null,
        bbox: { west: 34, south: 0.9, east: 34.1, north: 1 },
        bands: [],
        ...overrides,
      },
    ],
    bands: [
      { index: 1, dtype: 'uint8', description: 'crop', nodata: 0 },
      { index: 2, dtype: 'uint8', description: null, nodata: null },
    ],
    bbox: { west: 34, south: 0.9, east: 34.1, north: 1 },
    total_pixels: 100,
    is_equal_area: false,
    proposed_crs: '+proj=laea +lat_0=0.95 +lon_0=34.05',
  },
  areas: null,
  preprocess: null,
  strata: null,
  active_job_id: null,
});

const job = (status: JobOut['status'], progress = 0, error: string | null = null): JobOut => ({
  id: 'job1',
  map_id: 'abc',
  kind: 'preprocess',
  status,
  progress,
  error,
  result:
    status === 'done'
      ? {
          grid: {
            crs: 'LAEA',
            resolution_m: 10,
            width: 1,
            height: 1,
            transform: [0, 0, 0, 0, 0, 0],
          },
          band: 1,
          total: { '0': 5, '1': 95 },
          by_area: { 'area-1': { '1': 40 } },
          footprint_pixels: 100,
          masked_pixels: 0,
          declared_nodata: [0],
        }
      : null,
});

describe('inspectRaster', () => {
  it('uploads the file and reads the map the backend describes', async () => {
    sdk.uploadMap.mockResolvedValue({ data: mapOut() });
    const file = new File(['x'], 'crop.tif');

    const result = await inspectRaster(42, file);

    expect(sdk.uploadMap).toHaveBeenCalledWith({
      path: { campaign_id: 42 },
      body: { files: [file] },
    });
    expect(result.equalAreaCrs).toBe('+proj=laea +lat_0=0.95 +lon_0=34.05');
    expect(result.raster.mapId).toBe('abc');
    expect(result.raster.bands).toEqual([
      { index: 1, description: 'crop', noData: 0 },
      { index: 2, description: null, noData: null },
    ]);
    // A map in degrees has no pixel area of its own; the count supplies one.
    expect(result.raster.areaPerPixel).toBeNull();
    expect(result.raster.resolutionMeters).toBeNull();
  });

  it('links a URL instead of uploading and keeps a projected map pixel area', async () => {
    sdk.linkMap.mockResolvedValue({
      data: mapOut({ is_geographic: false, pixel_area_m2: 100, resolution: [10, 10] }),
    });

    const result = await inspectRaster(42, 'https://example.com/crop.tif');

    expect(sdk.linkMap).toHaveBeenCalledWith({
      path: { campaign_id: 42 },
      body: { urls: ['https://example.com/crop.tif'] },
    });
    expect(result.raster.areaPerPixel).toBe(100);
    expect(result.raster.resolutionMeters).toBe(10);
  });

  it("surfaces the backend's reason when the map is refused", async () => {
    sdk.uploadMap.mockResolvedValue({
      error: { detail: 'crop.tif has no coordinate reference system' },
    });
    await expect(inspectRaster(42, new File(['x'], 'crop.tif'))).rejects.toThrow(
      /no coordinate reference system/
    );
  });
});

describe('censusPixels', () => {
  it('polls the job to completion, reporting progress, and keys the map total as the whole map', async () => {
    vi.useFakeTimers();
    sdk.preprocess.mockResolvedValue({ data: job('queued') });
    sdk.getJob
      .mockResolvedValueOnce({ data: job('running', 0.5) })
      .mockResolvedValueOnce({ data: job('done', 1) });
    const progress: number[] = [];

    const pending = censusPixels(42, 'abc', 1, 'EPSG:6933', (f) => progress.push(f));
    await vi.runAllTimersAsync();
    const census = await pending;
    vi.useRealTimers();

    expect(sdk.preprocess).toHaveBeenCalledWith({
      path: { campaign_id: 42, map_id: 'abc' },
      body: { band: 1, crs: 'EPSG:6933' },
    });
    expect(progress).toEqual([0, 0.5, 1]);
    expect(census).toEqual({
      bandIndex: 1,
      crs: 'LAEA',
      pixelAreaM2: 100,
      byArea: { 'area-1': { '1': 40 }, [WHOLE_MAP_AREA_ID]: { '0': 5, '1': 95 } },
    });
  });

  it('fails with the job error when the count fails', async () => {
    sdk.preprocess.mockResolvedValue({ data: job('failed', 0.2, 'tiles disagree') });
    await expect(censusPixels(42, 'abc', 1, 'EPSG:6933')).rejects.toThrow('tiles disagree');
  });
});

const CAMPAIGN = 42;
const TASK_SET = 7;
const KEY = `stacnotator.areaEstimation.${CAMPAIGN}.${TASK_SET}`;

describe('loadPlan', () => {
  beforeEach(() => localStorage.clear());

  it("keeps each task set's design apart", async () => {
    await savePlan(CAMPAIGN, 1, { ...emptyPlan(), targetCv: 0.02 });
    await savePlan(CAMPAIGN, 2, { ...emptyPlan(), targetCv: 0.1 });

    expect((await loadPlan(CAMPAIGN, 1))?.targetCv).toBe(0.02);
    expect((await loadPlan(CAMPAIGN, 2))?.targetCv).toBe(0.1);
    expect(await listPlannedTaskSets(CAMPAIGN)).toEqual(expect.arrayContaining([1, 2]));
    expect(await listPlannedTaskSets(99)).toEqual([]);
  });

  it('returns null when the campaign has no plan', async () => {
    expect(await loadPlan(CAMPAIGN, TASK_SET)).toBeNull();
  });

  it('round-trips a plan it saved', async () => {
    const plan = { ...emptyPlan(), targetCv: 0.02 };
    await savePlan(CAMPAIGN, TASK_SET, plan);
    expect(await loadPlan(CAMPAIGN, TASK_SET)).toEqual(plan);
  });

  it('fills in fields a plan stored by an older version never had', async () => {
    const { equalAreaCrs: _dropped, ...older } = emptyPlan();
    localStorage.setItem(KEY, JSON.stringify(older));

    const loaded = await loadPlan(CAMPAIGN, TASK_SET);

    expect(loaded?.equalAreaCrs).toBe(emptyPlan().equalAreaCrs);
  });

  it('loads a plan whose stored map predates the extent being recorded', async () => {
    const plan = emptyPlan();
    const { bbox: _dropped, ...raster } = {
      name: 'cropmap.tif',
      bands: [{ index: 1, description: null, noData: null }],
      crs: 'EPSG:6933',
      isEqualArea: true,
      areaPerPixel: 100,
      resolutionMeters: 10,
      bbox: { west: 0, south: 0, east: 1, north: 1 },
    };
    localStorage.setItem(KEY, JSON.stringify({ ...plan, raster }));

    const loaded = await loadPlan(CAMPAIGN, TASK_SET);

    expect(loaded?.raster?.bbox).toBeUndefined();
    expect(proposedEqualAreaCrs(loaded!.raster!)).toBeNull();
  });

  it('returns null rather than throwing on a corrupt entry', async () => {
    localStorage.setItem(KEY, 'not json');
    expect(await loadPlan(CAMPAIGN, TASK_SET)).toBeNull();
  });
});
