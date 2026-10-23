import { Fragment } from 'react';
import { capitalizeFirst } from '~/shared/utils/utility';

export interface LabelChipItem {
  id: number;
  name: string;
  /** Swatch color, e.g. a resolved label style's fill. Omitted -> no swatch. */
  color?: string;
  /** Swatch border, when it differs from the fill - a label style resolves a
   *  stroke colour of its own. */
  borderColor?: string;
}

export interface LabelChipsProps<L extends LabelChipItem> {
  labels: L[];
  selectedId: number | null;
  onSelect: (label: L) => void;
  disabled?: boolean;
  /** Geometry-restriction filter hook: labels failing this predicate are left
   *  out of the row entirely. */
  isSelectable?: (label: L) => boolean;
  /** Digit hints (1-based position) shown at the trailing edge of each chip. */
  showIndex?: boolean;
  /** Trailing glyph, left of the digit hint - e.g. Explore's geometry-type
   *  icon. */
  renderIcon?: (label: L) => React.ReactNode;
  /** Trailing controls outside the chip button, e.g. the style-editor toggle. */
  renderAfter?: (label: L) => React.ReactNode;
  /** Panel rendered on its own full-width line right under the label's chip. */
  renderUnder?: (label: L) => React.ReactNode;
  /** Let the chips stretch across the row instead of keeping a fixed width. */
  fill?: boolean;
  /** Lay the chips on a grid, each at least this wide in px and all
   *  stretched evenly to fill the row, a new column as soon as one fits. */
  minWidth?: number;
}

export function LabelChips<L extends LabelChipItem>({
  labels,
  selectedId,
  onSelect,
  disabled = false,
  isSelectable,
  showIndex = true,
  renderIcon,
  renderAfter,
  renderUnder,
  fill = false,
  minWidth,
}: LabelChipsProps<L>) {
  const visible = isSelectable ? labels.filter(isSelectable) : labels;

  return (
    <div
      className={minWidth != null ? 'grid gap-1.5' : 'flex flex-wrap gap-1.5'}
      style={
        minWidth != null
          ? { gridTemplateColumns: `repeat(auto-fill, minmax(min(${minWidth}px, 100%), 1fr))` }
          : undefined
      }
    >
      {visible.map((label, index) => {
        const selected = selectedId === label.id;
        const under = renderUnder?.(label);
        return (
          <Fragment key={label.id}>
            <div
              className={`flex items-center gap-1 min-w-0 max-w-full ${
                fill && minWidth == null ? 'grow shrink basis-40' : ''
              }`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(label)}
                className={`${
                  minWidth != null || fill ? 'grow shrink basis-0' : 'w-40'
                } self-stretch min-w-0 text-left px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-2 justify-between ${
                  selected
                    ? 'bg-brand-50 text-brand-700 border-brand-600 border font-semibold'
                    : 'bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-400 text-neutral-700 border-neutral-200 border'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {label.color && (
                    <span
                      className="w-3 h-3 rounded-sm border flex-shrink-0"
                      style={{
                        backgroundColor: label.color,
                        borderColor: label.borderColor ?? label.color,
                      }}
                    />
                  )}
                  <span className="min-w-0 break-words">
                    {selected ? '✓ ' : ''}
                    {capitalizeFirst(label.name)}
                  </span>
                </span>
                <span className="text-neutral-400 text-[10px] ml-1 flex flex-shrink-0 items-center gap-0.5 tabular-nums">
                  {renderIcon?.(label)}
                  {showIndex && <span>{index + 1}</span>}
                </span>
              </button>
              {renderAfter?.(label)}
            </div>
            {under && <div className="basis-full w-full col-span-full">{under}</div>}
          </Fragment>
        );
      })}
    </div>
  );
}
