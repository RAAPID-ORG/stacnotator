import type { LabelBase } from '~/api/client';
import { LabelChips } from '../../components/LabelChips';

export interface LabelGridProps {
  labels: LabelBase[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  disabled?: boolean;
}

/** Labels fill the row evenly, a new column as soon as another fits: the
 *  panel's own size, set in Edit Layout, decides how many sit side by side. */
const MIN_LABEL_WIDTH = 128;

export function LabelGrid({ labels, selectedId, onSelect, disabled }: LabelGridProps) {
  return (
    <LabelChips
      fill
      minWidth={MIN_LABEL_WIDTH}
      labels={labels}
      selectedId={selectedId}
      onSelect={(label) => onSelect(selectedId === label.id ? null : label.id)}
      disabled={disabled}
    />
  );
}
