import { useEffect, useRef, useState, type ReactNode } from 'react';

const itemClass =
  'flex w-full items-center gap-2.5 px-2 py-1.5 rounded-md text-left text-[13px] cursor-pointer ' +
  'transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:bg-neutral-100';

type SidebarMenuProps = {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  testId?: string;
  children: (close: () => void) => ReactNode;
};

/** A menu that opens upward from a sidebar row and closes on any click outside it. */
export const SidebarMenu = ({
  label,
  trigger,
  triggerClassName,
  testId,
  children,
}: SidebarMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid={testId}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`w-full rounded-md text-left cursor-pointer transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 ${
          open ? 'bg-neutral-100' : ''
        } ${triggerClassName ?? ''}`}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute bottom-full left-0 mb-1 w-64 max-h-[70vh] overflow-y-auto p-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-50"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

type MenuItemProps = {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  checked?: boolean;
  trailing?: ReactNode;
  tone?: 'default' | 'danger';
  testId?: string;
};

/** One entry: an action, or a choice when `checked` is given. */
export const MenuItem = ({
  icon,
  children,
  onSelect,
  checked,
  trailing,
  tone = 'default',
  testId,
}: MenuItemProps) => (
  <button
    type="button"
    role={checked === undefined ? 'menuitem' : 'menuitemradio'}
    aria-checked={checked}
    onClick={onSelect}
    data-testid={testId}
    className={`${itemClass} ${tone === 'danger' ? 'text-red-700' : 'text-neutral-700'}`}
  >
    <span className="flex w-4 h-4 shrink-0 items-center justify-center text-neutral-400 [&>svg]:w-4 [&>svg]:h-4">
      {icon}
    </span>
    <span className="flex-1 min-w-0 truncate">{children}</span>
    {trailing}
  </button>
);

export const MenuSeparator = () => (
  <div role="separator" className="my-1 border-t border-neutral-100" />
);
