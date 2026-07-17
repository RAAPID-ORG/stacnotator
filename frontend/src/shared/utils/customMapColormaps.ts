/**
 * Mirrors the `colormap_name` literal union on the backend's `RenderConfig`.
 * Growing this set means adding matching stops below and to the backend schema.
 */
export const COLORMAPS = [
  'viridis',
  'plasma',
  'magma',
  'inferno',
  'cividis',
  'turbo',
  'rdylgn',
  'rdbu',
] as const;

export type ColormapName = (typeof COLORMAPS)[number];

export const isColormapName = (value: string): value is ColormapName =>
  COLORMAPS.some((c) => c === value);

/** Approximations of the tiler's colormaps. Legend gradients only; the tiler renders the truth. */
const STOPS: Record<ColormapName, string[]> = {
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
  cividis: ['#00204d', '#00336f', '#39486b', '#7c7b78', '#bcaf6f', '#ffea46'],
  turbo: ['#30123b', '#4145ab', '#4675ed', '#1ddfa3', '#a4fc3c', '#fb8022', '#7a0403'],
  rdylgn: ['#a50026', '#f46d43', '#fee08b', '#d9ef8b', '#66bd63', '#006837'],
  rdbu: ['#67001f', '#d6604d', '#fddbc7', '#f7f7f7', '#d1e5f0', '#4393c3', '#053061'],
};

const GRAYSCALE = 'linear-gradient(to right, #000000, #ffffff)';

export function gradientFor(name: string): string {
  const key = name.toLowerCase();
  if (!isColormapName(key)) return GRAYSCALE;
  return `linear-gradient(to right, ${STOPS[key].join(', ')})`;
}

export function formatTick(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(2)).toString();
}
