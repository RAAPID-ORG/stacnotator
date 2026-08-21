/**
 * Estimators for stratified random sampling, Olofsson et al. (2014) Section 4.
 *
 * Every number reported to the user comes from here. The map's own pixel
 * counts are never reported as area: they enter only as stratum weights W_i.
 */

export interface StratumSample {
  id: string;
  /** Pixels in the stratum, giving W_i. */
  pixelCount: number;
  /** Reference-class counts among the annotated points of this stratum. */
  counts: Record<string, number>;
}

export interface ClassEstimate {
  classId: string;
  /** Estimated proportion of the study area, Olofsson Eq. 9. */
  proportion: number;
  standardError: number;
  /** Half-width of the 95% confidence interval, on the proportion. */
  marginOfError: number;
  /** Relative standard error; the target of the design step. */
  cv: number;
  area: number;
  areaStandardError: number;
  areaMarginOfError: number;
  /** What pixel-counting the map would have claimed, shown only as a contrast. */
  mappedArea: number;
  usersAccuracy: Accuracy | null;
  producersAccuracy: Accuracy | null;
}

export interface Accuracy {
  value: number;
  standardError: number;
  marginOfError: number;
}

export interface AreaEstimates {
  classes: ClassEstimate[];
  overallAccuracy: Accuracy | null;
  /** Annotated points per stratum, the denominator behind every figure above. */
  annotated: Record<string, number>;
  totalAnnotated: number;
}

const Z_95 = 1.96;

const sampleTotal = (counts: Record<string, number>) =>
  Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0);

/**
 * @param areaPerPixel area of one pixel in the unit the caller wants results in.
 */
export const estimateAreas = (
  strata: readonly StratumSample[],
  classIds: readonly string[],
  areaPerPixel: number
): AreaEstimates => {
  const totalPixels = strata.reduce((sum, s) => sum + Math.max(0, s.pixelCount), 0);
  const totalArea = totalPixels * areaPerPixel;
  const w = strata.map((s) => (totalPixels > 0 ? Math.max(0, s.pixelCount) / totalPixels : 0));
  const n = strata.map((s) => sampleTotal(s.counts));

  const share = (i: number, classId: string) =>
    n[i] > 0 ? Math.max(0, strata[i].counts[classId] ?? 0) / n[i] : 0;

  const classes = classIds.map((classId) => {
    // Eq. 9: p_k = sum over strata of W_i * (n_ik / n_i).
    const proportion = strata.reduce((sum, _, i) => sum + w[i] * share(i, classId), 0);
    // Eq. 10: the stratified standard error of that proportion.
    const variance = strata.reduce((sum, _, i) => {
      if (n[i] < 2) return sum;
      const p = share(i, classId);
      return sum + w[i] * w[i] * ((p * (1 - p)) / (n[i] - 1));
    }, 0);
    const standardError = Math.sqrt(variance);
    const stratumIndex = strata.findIndex((s) => s.id === classId);
    return {
      classId,
      proportion,
      standardError,
      marginOfError: Z_95 * standardError,
      cv: proportion > 0 ? standardError / proportion : Number.POSITIVE_INFINITY,
      area: proportion * totalArea,
      areaStandardError: standardError * totalArea,
      areaMarginOfError: Z_95 * standardError * totalArea,
      mappedArea: stratumIndex >= 0 ? strata[stratumIndex].pixelCount * areaPerPixel : 0,
      usersAccuracy: stratumIndex >= 0 ? usersAccuracy(strata, n, stratumIndex, classId) : null,
      producersAccuracy: producersAccuracy(strata, w, n, classId, proportion),
    };
  });

  return {
    classes,
    overallAccuracy: overallAccuracy(strata, w, n),
    annotated: Object.fromEntries(strata.map((s, i) => [s.id, n[i]])),
    totalAnnotated: n.reduce((a, b) => a + b, 0),
  };
};

/** Eq. 1 and 6: the share of a mapped class that the reference data agrees with. */
const usersAccuracy = (
  strata: readonly StratumSample[],
  n: readonly number[],
  i: number,
  classId: string
): Accuracy | null => {
  if (n[i] < 2) return null;
  const value = Math.max(0, strata[i].counts[classId] ?? 0) / n[i];
  const standardError = Math.sqrt((value * (1 - value)) / (n[i] - 1));
  return { value, standardError, marginOfError: Z_95 * standardError };
};

/** Eq. 3 and 7: the share of a class on the ground that the map found. */
const producersAccuracy = (
  strata: readonly StratumSample[],
  w: readonly number[],
  n: readonly number[],
  classId: string,
  proportionOfClass: number
): Accuracy | null => {
  const j = strata.findIndex((s) => s.id === classId);
  if (j < 0 || n[j] < 2 || proportionOfClass <= 0) return null;

  const pjj = w[j] * (Math.max(0, strata[j].counts[classId] ?? 0) / n[j]);
  const value = pjj / proportionOfClass;
  const uj = Math.max(0, strata[j].counts[classId] ?? 0) / n[j];

  const leadingTerm =
    w[j] * w[j] * (1 - value) * (1 - value) * ((uj * (1 - uj)) / Math.max(1, n[j] - 1));
  const trailingTerm = strata.reduce((sum, s, i) => {
    if (i === j || n[i] < 2) return sum;
    const p = Math.max(0, s.counts[classId] ?? 0) / n[i];
    return sum + w[i] * w[i] * ((p * (1 - p)) / (n[i] - 1));
  }, 0);

  const variance =
    (leadingTerm + value * value * trailingTerm) / (proportionOfClass * proportionOfClass);
  const standardError = Math.sqrt(Math.max(0, variance));
  return { value, standardError, marginOfError: Z_95 * standardError };
};

/** Eq. 2 and 5: the share of the study area the map labels correctly. */
const overallAccuracy = (
  strata: readonly StratumSample[],
  w: readonly number[],
  n: readonly number[]
): Accuracy | null => {
  if (!strata.some((_, i) => n[i] >= 2)) return null;
  let value = 0;
  let variance = 0;
  strata.forEach((s, i) => {
    if (n[i] < 1) return;
    const ui = Math.max(0, s.counts[s.id] ?? 0) / n[i];
    value += w[i] * ui;
    if (n[i] >= 2) variance += w[i] * w[i] * ((ui * (1 - ui)) / (n[i] - 1));
  });
  const standardError = Math.sqrt(variance);
  return { value, standardError, marginOfError: Z_95 * standardError };
};
