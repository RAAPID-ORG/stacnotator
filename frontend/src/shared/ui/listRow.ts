// Single source of truth for data-table row styling (the tasks page table and
// the annotations page's two review tables) so separators, zebra striping,
// hover, and tint/selection washes stay identical across all three.
interface ListRowOpts {
  /** Wash for "mine"/assigned rows (e.g. tasks assigned to the current user). */
  tinted?: boolean;
  /** Wash for checkbox-selected rows; wins over tinted. */
  selected?: boolean;
  /** Left accent border for cross-component sync (e.g. hover-linked map marker). */
  highlighted?: boolean;
  extra?: string;
}

export const listRowCls = (index: number, opts: ListRowOpts = {}) => {
  const { tinted = false, selected = false, highlighted = false, extra = '' } = opts;
  const wash = selected
    ? 'bg-brand-50/60'
    : tinted
      ? 'bg-brand-50/30'
      : index % 2 === 1
        ? 'bg-neutral-50/50'
        : 'bg-white';

  return [
    'border-b border-neutral-100 hover:bg-neutral-100/70 transition-colors',
    wash,
    highlighted && 'border-l-2 border-l-brand-400',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
};

export const tableHeadRowCls = 'border-b border-neutral-200';
