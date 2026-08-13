import { useRef, useState } from 'react';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { Dropdown } from '~/shared/ui/motion';
import { IconKeyboard } from '~/shared/ui/Icons';
import { helpRows, type Binding } from '../../hotkeys';

const GROUP_LABELS: Record<NonNullable<Binding['group']>, string> = {
  edit: 'Editing',
  form: 'Form',
  mode: 'Mode',
  map: 'Map',
};

const GROUP_ORDER = ['edit', 'form', 'mode', 'map'] as const;

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside(containerRef, () => setOpen(false), open);

  const rows = helpRows();
  const sections = GROUP_ORDER.map((group) => ({
    group,
    rows: rows.filter((row) => row.group === group),
  })).filter((section) => section.rows.length > 0);

  return (
    <div ref={containerRef} className="relative" data-tour="keyboard-help">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
        title="Keyboard shortcuts"
        data-testid="help-menu-trigger"
      >
        <IconKeyboard className="w-5 h-5" />
      </button>
      <Dropdown open={open} className="absolute top-full right-0 mt-1 z-20 origin-top-right">
        <div
          className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[220px] max-h-[70vh] overflow-y-auto p-3"
          data-testid="help-menu"
        >
          <div className="text-[11px] font-medium text-neutral-500 mb-2 uppercase tracking-wider">
            Keyboard shortcuts
          </div>
          {sections.length === 0 && (
            <div className="text-xs text-neutral-400">No shortcuts active</div>
          )}
          <div className="space-y-2">
            {sections.map(({ group, rows }) => (
              <div key={group}>
                <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mt-1">
                  {GROUP_LABELS[group!]}
                </div>
                <ul className="space-y-0.5">
                  {rows.map((row) => (
                    <li
                      key={`${group}:${row.key}`}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="text-neutral-700">{row.help}</span>
                      <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                        {row.key}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
