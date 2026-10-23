import type { LabelBase } from '~/api/client';
import { LabelChips, type LabelChipsProps } from '../../components/LabelChips';

export interface LabelGridProps {
  labels: LabelBase[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  disabled?: boolean;
  minWidth?: number;
  resize?: LabelChipsProps<LabelBase>['resize'];
}

export function LabelGrid({
  labels,
  selectedId,
  onSelect,
  disabled,
  minWidth,
  resize,
}: LabelGridProps) {
  return (
    <LabelChips
      fill
      minWidth={minWidth}
      resize={resize}
      labels={labels}
      selectedId={selectedId}
      onSelect={(label) => onSelect(selectedId === label.id ? null : label.id)}
      disabled={disabled}
    />
  );
}
