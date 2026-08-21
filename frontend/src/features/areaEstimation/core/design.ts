/**
 * Sampling design for stratified random sampling, following Olofsson et al.
 * (2014) "Good practices for estimating area and assessing accuracy of land
 * change", Remote Sensing of Environment 148, 42-57.
 *
 * The map being validated is only a stratification device: its classes define
 * the strata, and pixel counts give the stratum weights. Nothing here treats a
 * pixel count as an area estimate.
 */

export type AllocationRule = 'neyman' | 'proportional' | 'equal';

/** One stratum as the planner sees it, before any sample has been annotated. */
export interface PlannedStratum {
  id: string;
  /** Pixels mapped to this stratum. Defines the stratum weight W_i. */
  pixelCount: number;
  /**
   * Prior belief: the share of this stratum that is truly the target class.
   * For the target class' own stratum this is its expected user's accuracy;
   * for the others it is the leakage the map is expected to have missed.
   */
  targetShare: number;
}

export interface StratumAllocation {
  id: string;
  n: number;
}

/** Precision of the estimated proportion of one class, given an allocation. */
export interface Precision {
  /** Expected proportion of the study area in the class, under the prior. */
  proportion: number;
  standardError: number;
  /** Relative standard error, the number users are asked to target. */
  cv: number;
}

const clampShare = (p: number) => Math.min(1, Math.max(0, p));

/** S_i = sqrt(p_i (1 - p_i)), Cochran (1977) Eq. 5.55. */
export const stratumStdDev = (targetShare: number): number => {
  const p = clampShare(targetShare);
  return Math.sqrt(p * (1 - p));
};

export const stratumWeights = (strata: readonly PlannedStratum[]): number[] => {
  const total = strata.reduce((sum, s) => sum + Math.max(0, s.pixelCount), 0);
  if (total <= 0) return strata.map(() => 0);
  return strata.map((s) => Math.max(0, s.pixelCount) / total);
};

/** Expected proportion of the whole study area in the target class. */
export const expectedProportion = (strata: readonly PlannedStratum[]): number => {
  const w = stratumWeights(strata);
  return strata.reduce((sum, s, i) => sum + w[i] * clampShare(s.targetShare), 0);
};

/**
 * The share of the total sample each stratum takes under a given rule.
 * Neyman minimises the variance of the target-class estimate; proportional
 * favours overall accuracy; equal favours per-class user's accuracy.
 */
export const allocationShares = (
  strata: readonly PlannedStratum[],
  rule: AllocationRule
): number[] => {
  const w = stratumWeights(strata);
  if (rule === 'equal') return strata.map(() => (strata.length ? 1 / strata.length : 0));
  if (rule === 'proportional') return w;
  const products = strata.map((s, i) => w[i] * stratumStdDev(s.targetShare));
  const total = products.reduce((a, b) => a + b, 0);
  // A prior with no variance anywhere (every stratum pure) leaves Neyman
  // undefined; fall back to proportional rather than dividing by zero.
  if (total <= 0) return w;
  return products.map((p) => p / total);
};

/**
 * Sample size needed to reach a target standard error for the target class,
 * given how the sample will be spread across strata. Generalises Cochran
 * (1977) Eq. 5.25 / Olofsson Eq. 13 to any allocation: with n_i = a_i n,
 * V(p) = (1/n) * sum(W_i^2 S_i^2 / a_i), so n = sum(W_i^2 S_i^2 / a_i) / SE^2.
 * The finite-population correction is dropped, as it is negligible for the
 * pixel counts involved and dropping it is conservative.
 */
export const requiredSampleSize = (
  strata: readonly PlannedStratum[],
  shares: readonly number[],
  targetStandardError: number
): number => {
  if (targetStandardError <= 0) return 0;
  const w = stratumWeights(strata);
  const numerator = strata.reduce((sum, s, i) => {
    const share = shares[i];
    if (share <= 0) return sum;
    const si = stratumStdDev(s.targetShare);
    return sum + (w[i] * w[i] * si * si) / share;
  }, 0);
  return Math.ceil(numerator / (targetStandardError * targetStandardError));
};

/**
 * Sample size for a target coefficient of variation of the target class area.
 * Returns 0 when the prior expects the class to be absent, since a relative
 * precision target is meaningless against a zero denominator.
 */
export const sampleSizeForTargetCv = (
  strata: readonly PlannedStratum[],
  rule: AllocationRule,
  targetCv: number
): number => {
  const proportion = expectedProportion(strata);
  if (proportion <= 0 || targetCv <= 0) return 0;
  return requiredSampleSize(strata, allocationShares(strata, rule), targetCv * proportion);
};

/**
 * Spread `total` units across strata by `rule`, then lift every stratum to
 * `floor`. Floors add to the total rather than being taken from the larger
 * strata: a floor is a statement about the minimum evidence per class, and
 * silently paying for it out of another stratum would degrade that stratum's
 * precision without saying so.
 */
export const allocate = (
  strata: readonly PlannedStratum[],
  total: number,
  rule: AllocationRule,
  floor: number
): StratumAllocation[] => {
  const shares = allocationShares(strata, rule);
  const raw = shares.map((share) => share * total);
  const rounded = largestRemainderRound(raw, Math.max(0, Math.round(total)));
  return strata.map((s, i) => ({ id: s.id, n: Math.max(floor, rounded[i]) }));
};

/** Round shares to integers that still sum to the requested total. */
const largestRemainderRound = (values: readonly number[], total: number): number[] => {
  const floors = values.map((v) => Math.floor(v));
  let remaining = total - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    out[i] += 1;
    remaining -= 1;
  }
  return out;
};

/**
 * Precision the planned allocation is expected to deliver, under the prior.
 * V(p) = sum(W_i^2 * S_i^2 / n_i), the design-stage counterpart of the
 * stratified standard error in Olofsson Eq. 10.
 */
export const anticipatedPrecision = (
  strata: readonly PlannedStratum[],
  allocation: readonly StratumAllocation[]
): Precision => {
  const w = stratumWeights(strata);
  const byId = new Map(allocation.map((a) => [a.id, a.n]));
  const variance = strata.reduce((sum, s, i) => {
    const n = byId.get(s.id) ?? 0;
    if (n <= 0) return sum;
    const si = stratumStdDev(s.targetShare);
    return sum + (w[i] * w[i] * si * si) / n;
  }, 0);
  const proportion = expectedProportion(strata);
  const standardError = Math.sqrt(variance);
  return {
    proportion,
    standardError,
    cv: proportion > 0 ? standardError / proportion : Number.POSITIVE_INFINITY,
  };
};

export const totalSampleSize = (allocation: readonly StratumAllocation[]): number =>
  allocation.reduce((sum, a) => sum + a.n, 0);
