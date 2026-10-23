export const sectionHeaderClass = (active = false) =>
  `text-[11px] font-medium uppercase tracking-wider ${
    active ? 'text-brand-700' : 'text-neutral-500'
  }`;

/** Lays out the labels and sections above the action bar: one per row when
 *  narrow, as many cells across as fit when wide, each row as tall as its
 *  tallest cell. Cells draw their own right and bottom rules; the grid hangs a
 *  pixel past the edge so the outer column's rule is clipped away. */
export const sectionGridClass =
  '-mr-px grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] content-start';

export const sectionCellClass = 'flex flex-col p-3 border-r border-b border-neutral-100';
