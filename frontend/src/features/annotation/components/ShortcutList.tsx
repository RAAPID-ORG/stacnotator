import type { Shortcut } from '../hotkeys';

/** Uniform description + kbd rows for the shortcut help surfaces. `dense` is the
 * smaller side-panel legend style; the default matches the toolbar dropdowns. */
export function ShortcutList({
  shortcuts,
  dense = false,
}: {
  shortcuts: Shortcut[];
  dense?: boolean;
}) {
  return (
    <>
      {shortcuts.map((shortcut) => (
        <div
          key={`${shortcut.key}-${shortcut.description}`}
          className={
            dense
              ? 'flex justify-between text-[11px] text-neutral-500'
              : 'flex justify-between items-center text-xs'
          }
        >
          <span className={dense ? undefined : 'text-neutral-600'}>{shortcut.description}</span>
          <kbd
            className={`px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono ${
              dense ? 'text-neutral-600' : 'ml-2 text-neutral-700'
            }`}
          >
            {shortcut.key}
          </kbd>
        </div>
      ))}
    </>
  );
}
