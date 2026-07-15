import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface HeaderSelectOption {
  value: string | number;
  label: string;
  dimmed?: boolean;
}

interface HeaderSelectProps {
  value: string | number;
  options: HeaderSelectOption[];
  onChange: (value: string | number) => void;
  title: string;
  icon?: React.ReactNode;
  /** Dark-on-accent trigger style (for active imagery windows) */
  dark?: boolean;
  /** Compact size for use in smaller headers */
  compact?: boolean;
  /**
   * When set, each option gets a trailing flag toggle to mark it as the
   * "shown first" option. `markedValue` is the currently-marked value (its flag
   * stays lit); other flags reveal on row hover. Toggling calls `onMarkOption`.
   */
  markedValue?: string | number | null;
  onMarkOption?: (value: string | number) => void;
  markActiveTitle?: string;
  markInactiveTitle?: string;
}

/** Star = "this collection opens first". Filled when it's the marked option. */
const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const HeaderSelect = ({
  value,
  options,
  onChange,
  title,
  icon,
  dark,
  compact,
  markedValue,
  onMarkOption,
  markActiveTitle,
  markInactiveTitle,
}: HeaderSelectProps) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const selected = options.find((o) => o.value === value);

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 80);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const toggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      cancelClose();
      setOpen((o) => !o);
    },
    [cancelClose]
  );

  const handleSelect = (opt: HeaderSelectOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  // Position dropdown under button, clamped into the viewport. Flips above
  // the button when there's more room there than below, and always caps the
  // scrollable list height so options stay reachable instead of running off
  // screen with no way to scroll to them.
  useEffect(() => {
    if (!open || !buttonRef.current || !dropdownRef.current) return;
    const inner = dropdownRef.current.firstElementChild;
    if (!(inner instanceof HTMLElement)) return;

    // Measure against the button's own window - it may live in a popped-out
    // screen window, whose viewport differs from `window` (see the portal
    // target comment below).
    const win = buttonRef.current.ownerDocument.defaultView ?? window;
    const rect = buttonRef.current.getBoundingClientRect();

    const spaceBelow = win.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const desired = Math.min(inner.scrollHeight, 300);

    let top: number;
    let maxHeight: number;
    if (desired <= spaceBelow) {
      top = rect.bottom + 4;
      maxHeight = Math.min(300, spaceBelow);
    } else if (spaceAbove > spaceBelow) {
      maxHeight = Math.min(desired, spaceAbove);
      top = Math.max(4, rect.top - 4 - maxHeight);
    } else {
      top = rect.bottom + 4;
      maxHeight = Math.max(spaceBelow, 80);
    }

    const dropdownWidth = dropdownRef.current.getBoundingClientRect().width;
    const left = Math.max(4, Math.min(rect.left, win.innerWidth - dropdownWidth - 4));

    dropdownRef.current.style.top = `${top}px`;
    dropdownRef.current.style.left = `${left}px`;
    inner.style.maxHeight = `${maxHeight}px`;
  }, [open, options]);

  const h = compact ? 'h-5' : 'h-6';
  const text = compact ? 'text-[10px]' : 'text-[11px]';
  const btnClass = dark
    ? `${h} px-1.5 text-white/80 ${text} font-medium rounded-md hover:bg-white/15 hover:text-white transition-colors flex items-center gap-1 cursor-pointer`
    : `${h} px-1.5 text-neutral-500 ${text} font-medium rounded-md hover:bg-neutral-100 hover:text-neutral-700 transition-colors flex items-center gap-1.5 cursor-pointer`;

  return (
    <div className="select-none" onMouseLeave={scheduleClose} onMouseEnter={cancelClose}>
      <button
        ref={buttonRef}
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        className={btnClass}
        title={title}
      >
        {icon && <span className="opacity-40 shrink-0 flex items-center">{icon}</span>}
        <span className="truncate max-w-[11rem]">{selected?.label ?? ''}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 ${dark ? 'opacity-50' : 'opacity-40'}`}
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999]"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[180px] overflow-y-auto py-1">
              {options.map((opt) => {
                const isSelected = opt.value === value;
                if (!onMarkOption) {
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleSelect(opt)}
                      className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-2
                        ${isSelected ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-700 hover:bg-neutral-50'}
                        ${opt.dimmed ? 'opacity-50' : ''}
                      `}
                    >
                      <span
                        className={`w-1 h-1 rounded-full shrink-0 ${isSelected ? 'bg-brand-500' : 'bg-transparent'}`}
                      />
                      {opt.label}
                    </button>
                  );
                }
                const isMarked = markedValue != null && opt.value === markedValue;
                return (
                  <div
                    key={opt.value}
                    className={`flex items-center transition-colors
                      ${isSelected ? 'bg-brand-50' : 'hover:bg-neutral-50'}
                      ${opt.dimmed ? 'opacity-50' : ''}`}
                  >
                    <button
                      onClick={() => handleSelect(opt)}
                      className={`flex-1 min-w-0 text-left pl-3 py-1.5 text-xs cursor-pointer flex items-center gap-2
                        ${isSelected ? 'text-brand-700 font-medium' : 'text-neutral-700'}`}
                    >
                      <span
                        className={`w-1 h-1 rounded-full shrink-0 ${isSelected ? 'bg-brand-500' : 'bg-transparent'}`}
                      />
                      <span className="truncate">{opt.label}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkOption(opt.value);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      title={isMarked ? markActiveTitle : markInactiveTitle}
                      aria-pressed={isMarked}
                      className={`shrink-0 mr-1.5 ml-1 w-5 h-5 rounded flex items-center justify-center transition-colors cursor-pointer
                        ${
                          isMarked
                            ? 'text-brand-600 hover:text-brand-700'
                            : 'text-neutral-300 hover:text-neutral-500'
                        }`}
                    >
                      <StarIcon filled={isMarked} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          // The select may live in a pop-out screen window; portal into the
          // button's document so the dropdown opens next to it (the fixed
          // positioning above is relative to that window's viewport).
          buttonRef.current?.ownerDocument.body ?? document.body
        )}
    </div>
  );
};

export default HeaderSelect;
