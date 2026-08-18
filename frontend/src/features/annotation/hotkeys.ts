/**
 * The keyboard mechanism: one keydown listener over a stack of binding tables,
 * plus the help text and tooltips those bindings drive. Which keys the page
 * actually binds, and to what, lives in `keymap.ts`.
 */
import { useEffect } from 'react';

export interface Binding {
  /** 'a', 'shift+a', 'alt+arrowup', '1', 'escape', ' '. */
  key: string;
  /** Shown in the help panel and in button tooltips. Omit to bind a key
   *  without giving it its own help row - one row per group of label digits
   *  beats ten identical ones. */
  help?: string;
  /** Overrides the key shown in help, e.g. '1-9' for a run of digits. */
  helpKey?: string;
  /** Which help list this belongs to. The controls panel lists its mode's own
   *  keys; the help menu lists everything. */
  group?: 'edit' | 'form' | 'mode' | 'map';
  when?: () => boolean;
  run: (e: KeyboardEvent) => void;
  allowRepeat?: boolean;
  /** By default a binding is skipped while typing in an input. */
  allowInInput?: boolean;
}

/**
 * The active tables. Within a table the most specific binding comes first, and
 * the first one whose key matches and whose `when` passes wins - that ordering
 * is how Escape means "cancel the edit" while editing and "close the draft"
 * otherwise, with no scope or precedence machinery.
 *
 * Between tables, the most recently mounted wins: a table a local component
 * registers is more specific than the workspace-wide one the page installed.
 */
let tables: Binding[][] = [];

/** The guided tour needs to know the user pressed the key a step asks for.
 *  Observing here rather than on raw keydowns reuses this matching, and its
 *  `when` and typing guards. */
const observers = new Set<(key: string) => void>();

const MODIFIERS = ['shift', 'alt', 'ctrl', 'meta'] as const;

const MODIFIER_HELD: Record<(typeof MODIFIERS)[number], (e: KeyboardEvent) => boolean> = {
  shift: (e) => e.shiftKey,
  alt: (e) => e.altKey,
  ctrl: (e) => e.ctrlKey,
  meta: (e) => e.metaKey,
};

/** Not trimmed: the literal space-key spec ' ' must survive as the base. */
function parseKey(spec: string): { base: string; modifiers: string[] } {
  const parts = spec.split('+').map((p) => p.toLowerCase());
  return { base: parts[parts.length - 1], modifiers: parts.slice(0, -1) };
}

const DIGIT = /^[0-9]$/;

/**
 * `e.key` is the character produced, which on Shift or a non-US layout is not
 * the digit engraved on the key - Shift+1 emits '!', so a 'shift+1' binding
 * could never fire off `e.key` alone. `e.code` names the physical key.
 */
function matchesBase(e: KeyboardEvent, base: string): boolean {
  return e.key.toLowerCase() === base || (DIGIT.test(base) && e.code === `Digit${base}`);
}

export function matchKey(e: KeyboardEvent, spec: string): boolean {
  const { base, modifiers } = parseKey(spec);
  if (!matchesBase(e, base)) return false;
  return MODIFIERS.every((name) => MODIFIER_HELD[name](e) === modifiers.includes(name));
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function onKeyDown(e: KeyboardEvent): void {
  const typing = isTyping(e.target);
  const matches = (b: Binding) =>
    matchKey(e, b.key) &&
    (!e.repeat || b.allowRepeat) &&
    (!typing || b.allowInInput) &&
    (!b.when || b.when());

  for (let i = tables.length - 1; i >= 0; i--) {
    const hit = tables[i].find(matches);
    if (!hit) continue;
    hit.run(e);
    e.preventDefault();
    for (const observe of observers) observe(hit.key);
    return;
  }
}

/** Install `table` for as long as `deps` holds. Callers own the dependency
 *  list so a binding's closures capture fresh state, exactly as a plain
 *  effect would. */
export function useHotkeys(table: Binding[], deps: unknown[]): void {
  useEffect(() => {
    if (tables.length === 0) window.addEventListener('keydown', onKeyDown);
    tables.push(table);
    return () => {
      tables = tables.filter((t) => t !== table);
      if (tables.length === 0) window.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function onAnyBinding(cb: (key: string) => void): () => void {
  observers.add(cb);
  return () => {
    observers.delete(cb);
  };
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
};

/** 'shift+x' reads as 'Shift+X'. One renderer for the help panel, the button
 *  tooltips and the guided tour. */
export function keyLabel(spec: string): string {
  return spec
    .split('+')
    .map((part) => KEY_NAMES[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join('+');
}

/** Rows for a help list: every binding that carries help text, optionally
 *  narrowed to one group. */
export function helpRows(
  groups?: Binding['group'][]
): Array<{ key: string; help: string; group: Binding['group'] }> {
  return tables
    .flat()
    .flatMap((b) =>
      b.help && (!groups || (b.group && groups.includes(b.group)))
        ? [{ key: b.helpKey ?? keyLabel(b.key), help: b.help, group: b.group }]
        : []
    );
}

/** Tooltip taken from the binding itself, so a control can never advertise a
 *  key it is not bound to. */
export function hotkeyTip(table: Binding[], key: string, fallback = ''): string {
  const binding = table.find((b) => b.key === key);
  return binding?.help ? `${binding.help} (${keyLabel(binding.key)})` : fallback;
}
