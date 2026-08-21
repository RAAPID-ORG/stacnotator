import { describe, it, expect } from 'vitest';
import { estimateAreas, type StratumSample } from './estimate';

// Olofsson et al. (2014) Tables 8 and 9: the worked forest change example.
// Rows are map classes (the strata), columns the reference classification.
const CLASSES = ['deforestation', 'forest_gain', 'stable_forest', 'stable_non_forest'];

const SAMPLE: StratumSample[] = [
  {
    id: 'deforestation',
    pixelCount: 200_000,
    counts: { deforestation: 66, forest_gain: 0, stable_forest: 5, stable_non_forest: 4 },
  },
  {
    id: 'forest_gain',
    pixelCount: 150_000,
    counts: { deforestation: 0, forest_gain: 55, stable_forest: 8, stable_non_forest: 12 },
  },
  {
    id: 'stable_forest',
    pixelCount: 3_200_000,
    counts: { deforestation: 1, forest_gain: 0, stable_forest: 153, stable_non_forest: 11 },
  },
  {
    id: 'stable_non_forest',
    pixelCount: 6_450_000,
    counts: { deforestation: 2, forest_gain: 1, stable_forest: 9, stable_non_forest: 313 },
  },
];

// 30 m Landsat pixels, reported in hectares as the paper does.
const SQUARE_METRES_PER_PIXEL = 900;
const HECTARE = 10_000;

const estimates = estimateAreas(SAMPLE, CLASSES, SQUARE_METRES_PER_PIXEL);
const byClass = (id: string) => estimates.classes.find((c) => c.classId === id)!;
const inHectares = (squareMetres: number) => squareMetres / HECTARE;

describe('estimateAreas, against the published worked example', () => {
  it('reproduces the estimated area of each class within rounding', () => {
    expect(Math.round(inHectares(byClass('deforestation').area))).toBe(21_158);
    expect(Math.round(inHectares(byClass('forest_gain').area))).toBe(11_686);
    expect(Math.round(inHectares(byClass('stable_forest').area))).toBe(285_770);
    expect(Math.round(inHectares(byClass('stable_non_forest').area))).toBe(581_386);
  });

  it('reproduces the published 95% margins of error', () => {
    expect(Math.round(inHectares(byClass('deforestation').areaMarginOfError))).toBe(6158);
    expect(Math.round(inHectares(byClass('forest_gain').areaMarginOfError))).toBe(3756);
    expect(Math.round(inHectares(byClass('stable_forest').areaMarginOfError))).toBe(15_510);
    expect(Math.round(inHectares(byClass('stable_non_forest').areaMarginOfError))).toBe(16_282);
  });

  it('reproduces the estimated proportion and standard error of deforestation', () => {
    expect(Number(byClass('deforestation').proportion.toFixed(3))).toBe(0.024);
    expect(Number(byClass('deforestation').standardError.toFixed(4))).toBe(0.0035);
  });

  it('reports the mapped area separately from the estimate', () => {
    // Pixel counting claims 18,000 ha of deforestation; the sample says 21,158.
    expect(inHectares(byClass('deforestation').mappedArea)).toBe(18_000);
  });

  it("reproduces user's accuracy with its confidence interval", () => {
    const rounded = (id: string) => {
      const ua = byClass(id).usersAccuracy!;
      return [Number(ua.value.toFixed(2)), Number(ua.marginOfError.toFixed(2))];
    };
    expect(rounded('deforestation')).toEqual([0.88, 0.07]);
    expect(rounded('forest_gain')).toEqual([0.73, 0.1]);
    expect(rounded('stable_forest')).toEqual([0.93, 0.04]);
    expect(rounded('stable_non_forest')).toEqual([0.96, 0.02]);
  });

  it("reproduces every producer's accuracy", () => {
    const value = (id: string) => Number(byClass(id).producersAccuracy!.value.toFixed(2));
    expect(value('deforestation')).toBe(0.75);
    expect(value('forest_gain')).toBe(0.85);
    expect(value('stable_forest')).toBe(0.93);
    expect(value('stable_non_forest')).toBe(0.96);
  });

  it("computes producer's accuracy intervals from the linearised ratio variance", () => {
    const margin = (id: string) => Number(byClass(id).producersAccuracy!.marginOfError.toFixed(2));
    expect(margin('deforestation')).toBe(0.21);
    expect(margin('stable_forest')).toBe(0.03);

    // The paper prints 0.23 for forest gain and 0.01 for stable non-forest,
    // where Eq. 7 applied as written gives 0.25 and 0.02. Eq. 7 is the
    // linearised variance of the ratio p_jj / p_.j, which can be derived
    // independently and agrees term for term with what is implemented here,
    // and the other two classes land on the published figures exactly. The
    // published values for these two are taken to be the misprint.
    expect(margin('forest_gain')).toBe(0.25);
    expect(margin('stable_non_forest')).toBe(0.02);
  });

  it('reproduces overall accuracy', () => {
    const overall = estimates.overallAccuracy!;
    expect(Number(overall.value.toFixed(2))).toBe(0.95);
    expect(Number(overall.marginOfError.toFixed(2))).toBe(0.02);
  });

  it('counts every annotated point exactly once', () => {
    expect(estimates.totalAnnotated).toBe(640);
    expect(estimates.annotated).toEqual({
      deforestation: 75,
      forest_gain: 75,
      stable_forest: 165,
      stable_non_forest: 325,
    });
  });
});

describe('estimateAreas, degenerate inputs', () => {
  it('reports no accuracy at all when a stratum has a single point', () => {
    const thin = estimateAreas(
      [{ id: 'a', pixelCount: 100, counts: { a: 1, b: 0 } }],
      ['a', 'b'],
      1
    );
    expect(thin.classes[0].usersAccuracy).toBeNull();
    expect(thin.overallAccuracy).toBeNull();
  });

  it('survives a stratum nobody has annotated yet', () => {
    const partial = estimateAreas(
      [
        { id: 'a', pixelCount: 100, counts: { a: 40, b: 10 } },
        { id: 'b', pixelCount: 900, counts: {} },
      ],
      ['a', 'b'],
      1
    );
    expect(partial.classes[0].proportion).toBeCloseTo(0.08, 6);
    expect(Number.isFinite(partial.classes[0].standardError)).toBe(true);
  });
});
