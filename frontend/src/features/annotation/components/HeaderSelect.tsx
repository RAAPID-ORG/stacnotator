import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDown } from '~/shared/ui/Icons';

const MAX_LIST_HEIGHT_PX = 300;
const CLOSE_DELAY_MS = 80;
const VIEWPORT_GAP_PX = 4;

export interface HeaderSelectOption {
  value: string | number;
  label: string;
  /** Known-empty slices stay selectable but are visibly de-emphasised. */
  dimmed?: boolean;
  /** Marker drawn after the label, e.g. "this slice has a note". */
  badge?: ReactNode;
}

export interface HeaderSelectProps {
  value: string | number;
  options: HeaderSelectOption[];
  onChange: (value: string | number) => void;
  title: string;
  icon?: ReactNode;
  /** Marks one option as "shown first" (the pinned start collection). */
  markedValue?: string | number | null;
  onMarkOption?: (value: string | number) => void;
  markActiveTitle?: string;
  markInactiveTitle?: string;
  /** Imagery windows are small and sit on a dark header. */
  compact?: boolean;
  dark?: boolean;
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function HeaderSelect({
  value,
  options,
  onChange,
  title,
  icon,
  markedValue,
  onMarkOption,
  markActiveTitle,
  markInactiveTitle,
  compact,
  dark,
}: HeaderSelectProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, []);

  useEffect(() => {
    if (!open || !buttonRef.current || !listRef.current) return;
    const win = buttonRef.current.ownerDocument.defaultView ?? window;
    const rect = buttonRef.current.getBoundingClientRect();
    const list = listRef.current;
    const spaceBelow = win.innerHeight - rect.bottom - VIEWPORT_GAP_PX * 2;
    const spaceAbove = rect.top - VIEWPORT_GAP_PX * 2;
    const desiredHeight = Math.min(MAX_LIST_HEIGHT_PX, list.scrollHeight);
    const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow);
    const height = Math.min(MAX_LIST_HEIGHT_PX, availableHeight);
    const width = list.getBoundingClientRect().width;
    const top = openAbove
      ? rect.top - VIEWPORT_GAP_PX - Math.min(desiredHeight, height)
      : rect.bottom + VIEWPORT_GAP_PX;
    list.style.top = `${Math.max(VIEWPORT_GAP_PX, top)}px`;
    list.style.left = `${Math.max(VIEWPORT_GAP_PX, Math.min(rect.left, win.innerWidth - width - VIEWPORT_GAP_PX))}px`;
    list.style.maxHeight = `${height}px`;
  }, [open, options]);

  const select = (option: HeaderSelectOption) => {
    onChange(option.value);
    setOpen(false);
  };

  const selected = options.find((o) => o.value === value);

  return (
    <div className="select-none" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      <button
        ref={buttonRef}
        type="button"
        title={title}
        // The header is the panel's drag handle; a press on a control here
        // must not start dragging the panel.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          cancelClose();
          setOpen((o) => !o);
        }}
        className={`${compact ? 'h-5' : 'h-6'} px-1.5 flex items-center rounded-md font-medium cursor-pointer ${
          compact ? 'text-[10px] gap-1' : 'text-[11px] gap-1.5'
        } ${
          dark
            ? 'text-white/80 hover:bg-white/15 hover:text-white'
            : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
        } transition-colors`}
      >
        {icon && <span className="shrink-0 opacity-40 flex items-center">{icon}</span>}
        <span className="truncate max-w-[11rem]">{selected?.label ?? ''}</span>
        <IconChevronDown className={`w-2 h-2 shrink-0 ${dark ? 'opacity-50' : 'opacity-40'}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={listRef}
            className="fixed z-[9999] min-w-[180px] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            {options.map((option) => {
              const isSelected = option.value === value;
              const isMarked = markedValue != null && option.value === markedValue;
              return (
                <div
                  key={option.value}
                  className={`flex items-center ${isSelected ? 'bg-brand-50' : 'hover:bg-neutral-50'} ${option.dimmed ? 'opacity-50' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => select(option)}
                    className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left text-xs cursor-pointer ${isSelected ? 'font-medium text-brand-700' : 'text-neutral-700'}`}
                  >
                    <span
                      className={`h-1 w-1 shrink-0 rounded-full ${isSelected ? 'bg-brand-500' : 'bg-transparent'}`}
                    />
                    <span className="truncate">{option.label}</span>
                    {option.badge && <span className="shrink-0">{option.badge}</span>}
                  </button>
                  {onMarkOption && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkOption(option.value);
                      }}
                      title={isMarked ? markActiveTitle : markInactiveTitle}
                      aria-pressed={isMarked}
                      className={`ml-1 mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded cursor-pointer ${isMarked ? 'text-brand-600' : 'text-neutral-300 hover:text-neutral-500'}`}
                    >
                      <Star filled={isMarked} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>,
          buttonRef.current?.ownerDocument.body ?? document.body
        )}
    </div>
  );
}
