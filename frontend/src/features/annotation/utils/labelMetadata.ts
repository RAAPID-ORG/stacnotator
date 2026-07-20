import type { LabelBase } from '~/api/client';

export type GeometryType = 'point' | 'polygon' | 'line';

export interface ExtendedLabel extends LabelBase {
  geometry_type: GeometryType;
  color: string;
}

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

export const extendLabelsWithMetadata = (labels: LabelBase[]): ExtendedLabel[] =>
  labels.map((label, index) => ({
    ...label,
    geometry_type: (label.geometry_type as GeometryType) || 'polygon',
    color: LABEL_COLORS[index % LABEL_COLORS.length],
  }));

/** Labels a given annotation may be re-assigned to on edit: only those whose
 *  geometry matches the annotation's current label, since the drawn geometry
 *  can't change type. An unknown labelId leaves the full list (no constraint). */
export const labelsWithSameGeometry = (
  labels: ExtendedLabel[],
  labelId: number | null
): ExtendedLabel[] => {
  const current = labels.find((l) => l.id === labelId);
  if (!current) return labels;
  return labels.filter((l) => l.geometry_type === current.geometry_type);
};
