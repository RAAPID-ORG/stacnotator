/** The compact grid that choice buttons - labels and the options of category
 *  fields - sit on: each at least `minWidth` px, all stretched evenly to fill
 *  the row, a new column as soon as another fits. */
export const CHIP_MIN_WIDTH = 128;

export const chipGridStyle = (minWidth = CHIP_MIN_WIDTH): React.CSSProperties => ({
  gridTemplateColumns: `repeat(auto-fit, minmax(min(${minWidth}px, 100%), 1fr))`,
});
