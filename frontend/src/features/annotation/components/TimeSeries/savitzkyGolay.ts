/**
 * Savitzky-Golay smoothing filter wrapper for time series data.
 *
 * Uses the ml-savitzky-golay library (https://github.com/mljs/savitzky-golay)
 * which implements the algorithm described in:
 *   Savitzky, A.; Golay, M.J.E. (1964). "Smoothing and Differentiation of
 *   Data by Simplified Least Squares Procedures". Analytical Chemistry. 36 (8): 1627–1639.
 *
 * The library computes convolution coefficients via the Gram polynomial / least-squares
 * approach, equivalent to scipy.signal.savgol_filter.
 */

import sgFilter from 'ml-savitzky-golay';

/**
 * Apply Savitzky-Golay smoothing filter to an array of values.
 *
 * Handles null/missing values by interpolating them before filtering,
 * then re-nulling them in the output.
 *
 * @param data        - Input array (may contain nulls)
 * @param windowSize  - Smoothing window (must be odd, >= 5)
 * @param polyOrder   - Polynomial order (must be >= 1 and < windowSize)
 * @returns Smoothed array (same length, nulls preserved)
 */
export function savitzkyGolay(
  data: (number | null)[],
  windowSize: number,
  polyOrder: number,
): (number | null)[] {
  // Validate & clamp parameters
  windowSize = Math.max(5, windowSize);
  if (windowSize % 2 === 0) windowSize += 1; // must be odd
  polyOrder = Math.max(1, Math.min(polyOrder, windowSize - 1));

  const n = data.length;
  if (n === 0) return [];
  if (n < windowSize) {
    // Not enough points to apply the filter -return original
    return [...data];
  }

  // Record which indices are null
  const nullMask = data.map((v) => v === null);

  // Fill nulls via linear interpolation for the filter
  const filled = [...data] as number[];

  let lastValid = -1;
  for (let i = 0; i < n; i++) {
    if (!nullMask[i]) {
      if (lastValid >= 0 && lastValid < i - 1) {
        // Interpolate between lastValid and i
        const vStart = filled[lastValid];
        const vEnd = filled[i];
        const span = i - lastValid;
        for (let j = lastValid + 1; j < i; j++) {
          filled[j] = vStart + ((vEnd - vStart) * (j - lastValid)) / span;
        }
      }
      lastValid = i;
    }
  }
  // Forward fill leading nulls
  const firstValid = filled.findIndex((_, i) => !nullMask[i]);
  if (firstValid > 0) {
    for (let i = 0; i < firstValid; i++) filled[i] = filled[firstValid];
  }
  // Backward fill trailing nulls
  const lastValidIdx = (() => {
    for (let i = n - 1; i >= 0; i--) if (!nullMask[i]) return i;
    return -1;
  })();
  if (lastValidIdx >= 0 && lastValidIdx < n - 1) {
    for (let i = lastValidIdx + 1; i < n; i++) filled[i] = filled[lastValidIdx];
  }

  // Apply ml-savitzky-golay filter
  // h=1 (unit spacing), derivative=0 (smoothing only), pad='pre' to handle edges
  const smoothed = sgFilter(filled, 1, {
    windowSize,
    derivative: 0,
    polynomial: polyOrder,
    pad: 'pre',
    padValue: 'replicate',
  });

  // Re-null masked positions
  const result: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = nullMask[i] ? null : smoothed[i];
  }

  return result;
}
