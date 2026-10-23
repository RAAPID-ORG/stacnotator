import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

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

/** A menu that opens upward from a sidebar row, with the keyboard behaviour of
 *  a menu button: arrows move between items, Escape returns to the trigger. */
export const SidebarMenu = ({
  label,
  trigger,
  triggerClassName,
  testId,
  children,
}: SidebarMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
    []
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    const all = items();
    (all.find((item) => item.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, items]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      // Refocus the trigger without cancelling the default, so Tab and
      // Shift-Tab leave the closed menu in natural document order.
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = items();
    const current = all.findIndex((item) => item === document.activeElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    all[(current + step + all.length) % all.length]?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
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
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-0 mb-1 w-64 max-h-[70vh] overflow-y-auto p-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-50"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
};

type MenuItemProps = {
  icon?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  tone?: 'default' | 'danger';
  testId?: string;
} & (
  | { onSelect: () => void; checked?: boolean; href?: never }
  | { href: string; onSelect?: () => void; checked?: never }
);

/** One entry: an action, a choice (`checked`) or an external link (`href`). */
export const MenuItem = ({
  icon,
  children,
  trailing,
  tone = 'default',
  testId,
  ...action
}: MenuItemProps) => {
  const content = (
    <>
      <span className="flex w-4 h-4 shrink-0 items-center justify-center text-neutral-400 [&>svg]:w-4 [&>svg]:h-4">
        {icon}
      </span>
      <span className="flex-1 min-w-0 truncate">{children}</span>
      {trailing}
    </>
  );
  const className = `${itemClass} ${tone === 'danger' ? 'text-red-700' : 'text-neutral-700'}`;

  if (action.href !== undefined) {
    return (
      <a
        role="menuitem"
        href={action.href}
        target="_blank"
        rel="noreferrer"
        onClick={action.onSelect}
        data-testid={testId}
        className={className}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      role={action.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={action.checked}
      onClick={action.onSelect}
      data-testid={testId}
      className={className}
    >
      {content}
    </button>
  );
};

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-neutral-400 truncate">
    {children}
  </div>
);

export const MenuSeparator = () => (
  <div role="separator" className="my-1 border-t border-neutral-100" />
);
