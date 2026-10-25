// One palette for a campaign's labels, so a label has the same colour on every page.
const LABEL_COLORS = [
  '#10b981',
  '#f59e0b',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#a3883a',
  '#6366f1',
  '#14b8a6',
];

export const labelColor = (index: number): string => LABEL_COLORS[index % LABEL_COLORS.length];
