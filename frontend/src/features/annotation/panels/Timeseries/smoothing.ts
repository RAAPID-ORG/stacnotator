import sgFilter from 'ml-savitzky-golay';

/** Smooths a series that may have gaps: nulls are interpolated so the filter
 *  sees an evenly spaced signal, then restored so gaps stay gaps. */
export function savitzkyGolay(
  data: (number | null)[],
  windowSize: number,
  polyOrder: number
): (number | null)[] {
  windowSize = Math.max(5, windowSize);
  if (windowSize % 2 === 0) windowSize += 1;
  polyOrder = Math.max(1, Math.min(polyOrder, windowSize - 1));

  const n = data.length;
  if (n === 0) return [];
  if (n < windowSize) return [...data];

  const isNull = data.map((v) => v === null);
  const filled = [...data] as number[];

  let lastValid = -1;
  for (let i = 0; i < n; i++) {
    if (isNull[i]) continue;
    if (lastValid >= 0 && lastValid < i - 1) {
      const start = filled[lastValid];
      const span = i - lastValid;
      const step = (filled[i] - start) / span;
      for (let j = lastValid + 1; j < i; j++) filled[j] = start + step * (j - lastValid);
    }
    lastValid = i;
  }

  const firstValid = isNull.indexOf(false);
  for (let i = 0; i < firstValid; i++) filled[i] = filled[firstValid];
  for (let i = lastValid + 1; i < n; i++) filled[i] = filled[lastValid];

  const smoothed = sgFilter(filled, 1, {
    windowSize,
    derivative: 0,
    polynomial: polyOrder,
    pad: 'pre',
    padValue: 'replicate',
  });

  return data.map((_, i) => (isNull[i] ? null : smoothed[i]));
}
