/** How the numbers in this feature are written down for a non-specialist. */

const HECTARES_PER_SQUARE_METRE = 1 / 10_000;

export const hectares = (squareMetres: number): number => squareMetres * HECTARES_PER_SQUARE_METRE;

/** Areas span six orders of magnitude here, so the unit follows the number. */
export const formatArea = (squareMetres: number): string => {
  const ha = hectares(squareMetres);
  if (ha >= 1_000_000) return `${(ha / 1_000_000).toFixed(2)} Mha`;
  if (ha >= 1_000) return `${(ha / 1_000).toFixed(1)} kha`;
  return `${ha.toFixed(0)} ha`;
};

export const formatPercent = (fraction: number, digits = 1): string =>
  Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : '—';

export const formatCount = (n: number): string => n.toLocaleString('en-US');

export const formatPixels = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
};
