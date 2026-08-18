import type { LabelBase } from '~/api/client';
import { LabelChips } from '../../components/LabelChips';

export interface LabelGridProps {
  labels: LabelBase[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  disabled?: boolean;
}

export function LabelGrid({ labels, selectedId, onSelect, disabled }: LabelGridProps) {
  return (
    <LabelChips
      fill
      labels={labels}
      selectedId={selectedId}
      onSelect={(label) => onSelect(selectedId === label.id ? null : label.id)}
      disabled={disabled}
    />
  );
}
