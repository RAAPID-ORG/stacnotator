/** The label column's own geometry, in px, as rendered: the gap between
 *  chips, and its horizontal padding plus border. */
export interface LabelColumnBox {
  gap: number;
  inset: number;
}

/** What the controls beside the labels get before the labels take another
 *  column of chips. */
export const RIGHT_COLUMN_PREFERRED = 256;

/** How many chips sit side by side in the label column of a panel this wide:
 *  as many as fit while leaving the other controls their preferred width,
 *  never fewer than one or more than there are labels. */
export function labelColumnCount(
  panelWidth: number,
  chipWidth: number,
  labelCount: number,
  box: LabelColumnBox
) {
  const room = panelWidth - box.inset - RIGHT_COLUMN_PREFERRED + box.gap;
  const fits = Math.floor(room / (chipWidth + box.gap));
  return Math.max(1, Math.min(fits, labelCount));
}

/** The label column's width when it holds `columns` chips side by side. */
export function labelColumnWidth(columns: number, chipWidth: number, box: LabelColumnBox) {
  return columns * chipWidth + (columns - 1) * box.gap + box.inset;
}
