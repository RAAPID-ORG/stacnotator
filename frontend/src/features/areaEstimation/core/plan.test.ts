import { describe, it, expect } from 'vitest';
import {
  NO_DATA_CLASS_ID,
  designsOf,
  domainsOf,
  emptyPlan,
  precisionCurves,
  oneClassPerValue,
  stratumId,
  studyAreaPixels,
  totalPoints,
  unassignedValues,
  validatePlan,
  type AreaEstimationPlan,
} from './plan';

const basePlan = (): AreaEstimationPlan => ({
  ...emptyPlan(),
  raster: {
    name: 'cropmap.tif',
    bands: [{ index: 1, description: 'crop_type' }],
    crs: 'EPSG:6933',
    isEqualArea: true,
    areaPerPixel: 100,
    resolutionMeters: 10,
  },
  values: [
    { value: 0, label: 'Nodata' },
    { value: 1, label: 'Wheat' },
    { value: 2, label: 'Rapeseed' },
    { value: 3, label: 'Non-cropland' },
  ],
  noDataValues: [0],
  areas: [
    { id: 'north', name: 'North', featureCount: 1 },
    { id: 'south', name: 'South', featureCount: 1 },
  ],
  census: {
    bandIndex: 1,
    byArea: {
      north: { '0': 100, '1': 300, '2': 100, '3': 500 },
      south: { '0': 200, '1': 100, '2': 100, '3': 600 },
    },
  },
  classes: [
    { id: 'cereal', name: 'Winter cereals', values: [1, 2] },
    { id: 'other', name: 'Non-cropland', values: [3] },
  ],
  targetClassId: 'cereal',
  priorSourceId: 'last_season_map',
  correctShares: { cereal: 0.85, other: 0.9 },
});

describe('oneClassPerValue', () => {
  it('offers one class per map value, leaving the nodata ones out', () => {
    expect(oneClassPerValue(basePlan()).map((c) => c.values)).toEqual([[1], [2], [3]]);
  });
});

describe('unassignedValues', () => {
  it('is empty when every value is either classed or nodata', () => {
    expect(unassignedValues(basePlan())).toEqual([]);
  });

  it('reports a value that belongs nowhere', () => {
    const plan = basePlan();
    plan.classes = [{ id: 'cereal', name: 'Winter cereals', values: [1] }];
    expect(unassignedValues(plan).map((v) => v.value)).toEqual([2, 3]);
  });
});

describe('domainsOf', () => {
  it('merges the areas into one population when they are reported together', () => {
    const domains = domainsOf(basePlan());
    expect(domains).toHaveLength(1);
    expect(domains[0].strata.map((s) => s.pixelCount)).toEqual([600, 1100]);
  });

  it('gives each area its own copy of every stratum when reported separately', () => {
    const plan = { ...basePlan(), domainMode: 'per_area' as const };
    const domains = domainsOf(plan);
    expect(domains.map((d) => d.name)).toEqual(['North', 'South']);
    expect(domains[0].strata.map((s) => s.pixelCount)).toEqual([400, 500]);
    expect(domains[1].strata.map((s) => s.id)).toEqual([
      stratumId('south', 'cereal'),
      stratumId('south', 'other'),
    ]);
  });

  it('leaves nodata pixels out of the population by default', () => {
    expect(studyAreaPixels(basePlan())).toBe(1700);
    // The total does not wait for the reporting classes to be drawn up.
    expect(studyAreaPixels({ ...basePlan(), classes: [] })).toBe(1700);
    expect(domainsOf(basePlan()).every((d) => d.strata.every((s) => !s.isNoData))).toBe(true);
  });

  it('keeps nodata pixels in the population when they are their own stratum', () => {
    const plan = { ...basePlan(), noDataHandling: 'stratum' as const };
    expect(studyAreaPixels(plan)).toBe(2000);
    const strata = domainsOf(plan)[0].strata;
    expect(strata.at(-1)).toMatchObject({ classId: NO_DATA_CLASS_ID, pixelCount: 300 });
  });

  it('assumes nothing about nodata pixels being right', () => {
    const plan = { ...basePlan(), noDataHandling: 'stratum' as const };
    const noData = domainsOf(plan)[0].strata.at(-1)!;
    // Its prior share of the target class is pure leakage from the classes
    // around it, never an accuracy of its own.
    expect(noData.targetShare).toBeGreaterThan(0);
    expect(noData.targetShare).toBeLessThan(1);
  });
});

describe('designsOf', () => {
  it('sizes the sample from the target precision when a prior is available', () => {
    const tight = designsOf({ ...basePlan(), targetCv: 0.02 });
    const loose = designsOf({ ...basePlan(), targetCv: 0.1 });
    expect(totalPoints(tight)).toBeGreaterThan(totalPoints(loose));
  });

  it('falls back to a pilot budget spread by area, with a floor per class', () => {
    const plan = { ...basePlan(), priorSourceId: 'none' as const, pilotPerStratum: 50 };
    // 50 per stratum is the budget; it is split by pixel count (600 vs 1100)
    // and then each stratum is lifted to the floor, which the small one needs.
    expect(designsOf(plan)[0].allocation.map((a) => a.n)).toEqual([50, 65]);
  });

  it('lets a hand-edited sample size win over the computed one', () => {
    const plan = basePlan();
    const id = stratumId('all', 'cereal');
    const design = designsOf({ ...plan, overrides: { [id]: 7 } })[0];
    expect(design.allocation.find((a) => a.id === id)?.n).toBe(7);
  });

  it('reports anticipated precision for every class, not only the target', () => {
    const design = designsOf(basePlan())[0];
    expect(design.perClass.map((p) => p.classId)).toEqual(['cereal', 'other']);
    expect(design.perClass.every((p) => Number.isFinite(p.precision.cv))).toBe(true);
  });

  it('multiplies the sample when each area is reported on separately', () => {
    const combined = totalPoints(designsOf(basePlan()));
    const perArea = totalPoints(designsOf({ ...basePlan(), domainMode: 'per_area' }));
    expect(perArea).toBeGreaterThan(combined);
  });
});

describe('precisionCurves', () => {
  const domain = () => domainsOf(basePlan())[0];

  it('improves every class as the sample grows', () => {
    const curves = precisionCurves(basePlan(), domain(), [200, 400, 800, 1600]);
    for (const series of curves) {
      const cvs = series.points.map((p) => p.cv);
      expect(cvs.length).toBeGreaterThan(1);
      expect([...cvs].sort((a, b) => b - a)).toEqual(cvs);
    }
  });

  it('reports one series per reporting class, nodata excluded', () => {
    const plan = { ...basePlan(), noDataHandling: 'stratum' as const };
    const curves = precisionCurves(plan, domainsOf(plan)[0], [400, 800]);
    expect(curves.map((c) => c.classId)).toEqual(['cereal', 'other']);
  });

  it('plots the totals actually drawn, so the floor is visible', () => {
    // A floor of 100 over two strata cannot draw fewer than 200 points, and
    // asking for less has to show up as the floor rather than as a fantasy.
    const curves = precisionCurves({ ...basePlan(), sampleFloor: 100 }, domain(), [10, 50, 400]);
    expect(curves[0].points.map((p) => p.total)).toEqual([200, 400]);
  });

  it('ignores hand-edited sample sizes, which are not on the curve', () => {
    const plan = basePlan();
    const edited = { ...plan, overrides: { [stratumId('all', 'cereal')]: 5000 } };
    expect(precisionCurves(edited, domainsOf(edited)[0], [400, 800])).toEqual(
      precisionCurves(plan, domain(), [400, 800])
    );
  });
});

describe('validatePlan', () => {
  it('passes a complete plan', () => {
    expect(validatePlan(basePlan())).toEqual([]);
  });

  it('asks for the map, the areas and the classes on an empty plan', () => {
    const steps = validatePlan(emptyPlan()).map((i) => i.step);
    expect(steps).toContain('data');
    expect(steps).toContain('classes');
  });

  it('asks for a target class once a prior removes the need for a pilot', () => {
    const plan = { ...basePlan(), targetClassId: null };
    expect(validatePlan(plan).some((i) => i.step === 'design')).toBe(true);
  });

  it('does not ask for a target class while the plan is only a pilot', () => {
    const plan = { ...basePlan(), targetClassId: null, priorSourceId: 'none' as const };
    expect(validatePlan(plan).some((i) => i.step === 'design')).toBe(false);
  });

  it('refuses a held-out test set as a prior', () => {
    const issues = validatePlan({ ...basePlan(), priorSourceId: 'held_out_test_set' });
    expect(issues.map((i) => i.step)).toContain('prior');
  });

  it('refuses a single reporting class', () => {
    const plan = basePlan();
    plan.classes = [{ id: 'cereal', name: 'Winter cereals', values: [1, 2, 3] }];
    expect(validatePlan(plan).some((i) => i.step === 'classes')).toBe(true);
  });

  it('refuses a map value left in no class', () => {
    const plan = basePlan();
    plan.classes = [{ id: 'cereal', name: 'Winter cereals', values: [1] }];
    plan.targetClassId = 'cereal';
    expect(validatePlan(plan).some((i) => i.message.includes('every map value'))).toBe(true);
  });
});
