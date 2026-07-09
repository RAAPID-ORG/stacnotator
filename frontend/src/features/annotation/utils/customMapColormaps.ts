const STOPS: Record<string, string[]> = {
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
  rdylgn: ['#a50026', '#f46d43', '#fee08b', '#d9ef8b', '#66bd63', '#006837'],
  turbo: ['#30123b', '#4145ab', '#4675ed', '#1ddfa3', '#a4fc3c', '#fb8022', '#7a0403'],
};

const GRAYSCALE = 'linear-gradient(to right, #000000, #ffffff)';

export function gradientFor(name: string): string {
  const stops = STOPS[name.toLowerCase()];
  if (!stops) return GRAYSCALE;
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function formatTick(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(2)).toString();
}
