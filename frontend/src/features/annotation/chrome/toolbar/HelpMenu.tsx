import { useState } from 'react';
import { getHelp, keyLabel, type HotkeyScope } from '~/features/annotation/engine/hotkeys';

const SCOPE_LABELS: Record<HotkeyScope, string> = {
  global: 'General',
  mode: 'Mode',
  form: 'Form',
  drawing: 'Drawing',
};

const SCOPE_ORDER: HotkeyScope[] = ['drawing', 'form', 'mode', 'global'];

export function HelpMenu() {
  const [open, setOpen] = useState(false);

  const bindings = open ? getHelp() : [];
  const byScope = SCOPE_ORDER.map((scope) => ({
    scope,
    rows: bindings.filter((b) => b.scope === scope),
  })).filter((group) => group.rows.length > 0);

  return (
    <div className="relative" data-tour="keyboard-help">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
        title="Keyboard shortcuts"
        data-testid="help-menu-trigger"
      >
        ?
      </button>
      {open && (
        <div
          className="absolute top-full right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 min-w-[220px] max-h-[70vh] overflow-y-auto p-3"
          data-testid="help-menu"
        >
          <div className="text-[11px] font-medium text-neutral-500 mb-2 uppercase tracking-wider">
            Keyboard shortcuts
          </div>
          {byScope.length === 0 && (
            <div className="text-xs text-neutral-400">No shortcuts active</div>
          )}
          <div className="space-y-2">
            {byScope.map(({ scope, rows }) => (
              <div key={scope}>
                <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mt-1">
                  {SCOPE_LABELS[scope]}
                </div>
                <ul className="space-y-0.5">
                  {rows.map((row) => (
                    <li
                      key={`${scope}:${row.key}`}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="text-neutral-700">{row.help}</span>
                      <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                        {keyLabel(row.key)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
