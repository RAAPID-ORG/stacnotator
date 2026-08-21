import { describe, it, expect } from 'vitest';
import {
  allocate,
  allocationShares,
  anticipatedPrecision,
  expectedProportion,
  requiredSampleSize,
  sampleSizeForTargetCv,
  stratumWeights,
  type PlannedStratum,
} from './design';

// Olofsson et al. (2014) Table 5: the worked deforestation example. Stratum
// weights and user's accuracies are given there; targetShare is the user's
// accuracy of each stratum for its own class.
const OLOFSSON: PlannedStratum[] = [
  { id: 'deforestation', pixelCount: 200_000, targetShare: 0.7 },
  { id: 'forest_gain', pixelCount: 150_000, targetShare: 0.6 },
  { id: 'stable_forest', pixelCount: 3_200_000, targetShare: 0.9 },
  { id: 'stable_non_forest', pixelCount: 6_450_000, targetShare: 0.95 },
];

describe('stratumWeights', () => {
  it('reproduces the published stratum weights', () => {
    const w = stratumWeights(OLOFSSON);
    expect(w.map((v) => Number(v.toFixed(3)))).toEqual([0.02, 0.015, 0.32, 0.645]);
  });

  it('returns zeros rather than NaN when no pixels are counted', () => {
    expect(stratumWeights([{ id: 'a', pixelCount: 0, targetShare: 0.5 }])).toEqual([0]);
  });
});

describe('requiredSampleSize', () => {
  it('matches Olofsson Eq. 13 for a target standard error of overall accuracy', () => {
    // The paper reports n = 641 for S(O) = 0.01 under Neyman allocation.
    const n = requiredSampleSize(OLOFSSON, allocationShares(OLOFSSON, 'neyman'), 0.01);
    expect(n).toBeGreaterThanOrEqual(639);
    expect(n).toBeLessThanOrEqual(643);
  });

  it('needs no sample when the target precision is unattainable', () => {
    expect(requiredSampleSize(OLOFSSON, allocationShares(OLOFSSON, 'neyman'), 0)).toBe(0);
  });
});

describe('allocationShares', () => {
  it('splits the sample evenly under equal allocation', () => {
    expect(allocationShares(OLOFSSON, 'equal')).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('follows the stratum weights under proportional allocation', () => {
    expect(allocationShares(OLOFSSON, 'proportional')).toEqual(stratumWeights(OLOFSSON));
  });

  it('falls back to proportional when the prior leaves no variance to optimise', () => {
    const pure: PlannedStratum[] = [
      { id: 'a', pixelCount: 10, targetShare: 1 },
      { id: 'b', pixelCount: 90, targetShare: 0 },
    ];
    expect(allocationShares(pure, 'neyman')).toEqual([0.1, 0.9]);
  });
});

describe('allocate', () => {
  it('reproduces the published proportional allocation of 641 units', () => {
    const counts = allocate(OLOFSSON, 641, 'proportional', 0).map((a) => a.n);
    expect(counts).toEqual([13, 10, 205, 413]);
  });

  it('distributes the whole sample without losing units to rounding', () => {
    const counts = allocate(OLOFSSON, 641, 'neyman', 0).map((a) => a.n);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(641);
  });

  it('lifts thin strata to the floor and lets the total grow', () => {
    const counts = allocate(OLOFSSON, 641, 'proportional', 100).map((a) => a.n);
    expect(counts).toEqual([100, 100, 205, 413]);
  });
});

describe('anticipatedPrecision', () => {
  it('reaches the target CV at the sample size derived for it', () => {
    const rule = 'neyman' as const;
    const n = sampleSizeForTargetCv(OLOFSSON, rule, 0.05);
    const precision = anticipatedPrecision(OLOFSSON, allocate(OLOFSSON, n, rule, 0));
    expect(precision.cv).toBeLessThanOrEqual(0.05);
    expect(precision.cv).toBeGreaterThan(0.045);
  });

  it('improves precision when a floor adds sample units', () => {
    const withoutFloor = anticipatedPrecision(OLOFSSON, allocate(OLOFSSON, 400, 'neyman', 0));
    const withFloor = anticipatedPrecision(OLOFSSON, allocate(OLOFSSON, 400, 'neyman', 100));
    expect(withFloor.standardError).toBeLessThan(withoutFloor.standardError);
  });

  it('reports an infinite CV when the prior expects the class to be absent', () => {
    const absent = OLOFSSON.map((s) => ({ ...s, targetShare: 0 }));
    expect(anticipatedPrecision(absent, allocate(absent, 400, 'equal', 0)).cv).toBe(Infinity);
  });
});

describe('expectedProportion', () => {
  it('weights each stratum prior by its share of the map', () => {
    expect(Number(expectedProportion(OLOFSSON).toFixed(4))).toBe(
      Number((0.02 * 0.7 + 0.015 * 0.6 + 0.32 * 0.9 + 0.645 * 0.95).toFixed(4))
    );
  });
});
