// Single source of truth for data-table body rows (tasks page table and the
// annotations page's two review tables) so hover and separators stay
// identical: light neutral-100 separators with a soft neutral-50 hover.
export const listRowCls = (tinted = false, extra = '') =>
  `border-b border-neutral-100 hover:bg-neutral-50 transition-colors ${
    tinted ? 'bg-brand-50/30' : 'bg-white'
  } ${extra}`.trim();
