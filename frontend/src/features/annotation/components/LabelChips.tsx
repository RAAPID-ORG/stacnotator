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
}: LabelChipsProps<L>) {
  const visible = isSelectable ? labels.filter(isSelectable) : labels;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((label, index) => {
        const selected = selectedId === label.id;
        return (
          <div key={label.id} className="flex items-center gap-1 min-w-0 max-w-full">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(label)}
              className={`w-40 min-w-0 text-left px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-2 justify-between ${
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
                <span className="truncate">
                  {selected ? '✓ ' : ''}
                  {capitalizeFirst(label.name)}
                </span>
              </span>
              <span className="text-neutral-400 text-[10px] ml-1 flex items-center gap-0.5 tabular-nums">
                {renderIcon?.(label)}
                {showIndex && <span>{index + 1}</span>}
              </span>
            </button>
            {renderAfter?.(label)}
          </div>
        );
      })}
    </div>
  );
}
