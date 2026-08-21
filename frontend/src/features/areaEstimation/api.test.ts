import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlan, savePlan } from './api';
import { emptyPlan } from './core/plan';

const CAMPAIGN = 42;
const KEY = `stacnotator.areaEstimation.${CAMPAIGN}`;

describe('loadPlan', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when the campaign has no plan', async () => {
    expect(await loadPlan(CAMPAIGN)).toBeNull();
  });

  it('round-trips a plan it saved', async () => {
    const plan = { ...emptyPlan(), targetCv: 0.02 };
    await savePlan(CAMPAIGN, plan);
    expect(await loadPlan(CAMPAIGN)).toEqual(plan);
  });

  it('fills in fields a plan stored by an older version never had', async () => {
    const { equalAreaCrs: _dropped, ...older } = emptyPlan();
    localStorage.setItem(KEY, JSON.stringify(older));

    const loaded = await loadPlan(CAMPAIGN);

    expect(loaded?.equalAreaCrs).toBe(emptyPlan().equalAreaCrs);
  });

  it('returns null rather than throwing on a corrupt entry', async () => {
    localStorage.setItem(KEY, 'not json');
    expect(await loadPlan(CAMPAIGN)).toBeNull();
  });
});
