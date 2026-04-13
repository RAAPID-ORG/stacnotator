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
}

const HeaderSelect = ({
  value,
  options,
  onChange,
  title,
  icon,
  dark,
  compact,
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

  // Position dropdown under button
  useEffect(() => {
    if (!open || !buttonRef.current || !dropdownRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    dropdownRef.current.style.top = `${rect.bottom + 4}px`;
    dropdownRef.current.style.left = `${rect.left}px`;
  }, [open]);

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
            <div className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[180px] max-h-[300px] overflow-y-auto py-1">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleSelect(opt)}
                  className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-2
                    ${opt.value === value ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-700 hover:bg-neutral-50'}
                    ${opt.dimmed ? 'opacity-50' : ''}
                  `}
                >
                  <span
                    className={`w-1 h-1 rounded-full shrink-0 ${opt.value === value ? 'bg-brand-500' : 'bg-transparent'}`}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default HeaderSelect;
