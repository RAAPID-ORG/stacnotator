import { describe, it, expect, beforeEach } from 'vitest';
import { listPlannedTaskSets, loadPlan, savePlan } from './api';
import { emptyPlan, proposedEqualAreaCrs } from './core/plan';

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
      bands: [{ index: 1 }],
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
