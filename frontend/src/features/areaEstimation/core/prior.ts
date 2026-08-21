/**
 * What the planner believes about the map before any point is annotated.
 *
 * Sample sizes cannot be chosen without a guess at how accurate the map is
 * (Olofsson et al. 2014, Section 5.1.1, Table 6). The guess only affects
 * precision, never bias: a poor prior costs wider confidence intervals, not a
 * wrong answer.
 */

export interface PriorMatrix {
  strataIds: string[];
  classIds: string[];
  /** rows[i][j] = expected share of stratum i that is truly class j. Rows sum to 1. */
  rows: number[][];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Build a full hypothesised error matrix from one number per stratum: the
 * share the map gets right. What is left over is spread over the other classes
 * in proportion to their size, the neutral assumption that mistakes land where
 * the land is. Users who know better edit the matrix directly.
 */
export const priorFromCorrectShares = (
  strataIds: readonly string[],
  weights: readonly number[],
  correctShares: readonly number[]
): PriorMatrix => {
  const classIds = [...strataIds];
  const rows = strataIds.map((_, i) => {
    const correct = clamp01(correctShares[i] ?? 0);
    const otherWeight = weights.reduce((sum, w, j) => (j === i ? sum : sum + w), 0);
    return strataIds.map((__, j) => {
      if (i === j) return correct;
      if (otherWeight <= 0) return (1 - correct) / Math.max(1, strataIds.length - 1);
      return (1 - correct) * (weights[j] / otherWeight);
    });
  });
  return { strataIds: [...strataIds], classIds, rows };
};

/** The prior share of each stratum that is truly `classId`: a column of the matrix. */
export const priorSharesOfClass = (prior: PriorMatrix, classId: string): number[] => {
  const col = prior.classIds.indexOf(classId);
  if (col < 0) return prior.strataIds.map(() => 0);
  return prior.rows.map((row) => clamp01(row[col] ?? 0));
};

/** Rescale a row so it sums to 1 after the user has edited one of its cells. */
export const normaliseRow = (row: readonly number[]): number[] => {
  const total = row.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return row.map(() => 0);
  return row.map((v) => Math.max(0, v) / total);
};
