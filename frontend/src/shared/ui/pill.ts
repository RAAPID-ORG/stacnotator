// Single source of truth for the rounded scope/toggle pills used by the
// task-set scope bar and the annotations page. Import instead of re-writing
// the class string so hover/active styling stays identical everywhere.
export const pillCls = (active: boolean, extra = '') =>
  `flex items-center gap-1.5 px-3 h-8 rounded-full text-sm border transition-colors ${
    active
      ? 'bg-brand-600 text-white border-brand-600'
      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300'
  } ${extra}`.trim();
