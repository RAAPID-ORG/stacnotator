import type { LabelBase } from '~/api/client';
import { LabelChips } from '~/features/annotation/panels/shared/LabelChips';

export interface LabelGridProps {
  labels: LabelBase[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  disabled?: boolean;
}

export function LabelGrid({ labels, selectedId, onSelect, disabled }: LabelGridProps) {
  return (
    <LabelChips
      labels={labels}
      selectedId={selectedId}
      onSelect={(label) => onSelect(selectedId === label.id ? null : label.id)}
      disabled={disabled}
    />
  );
}
