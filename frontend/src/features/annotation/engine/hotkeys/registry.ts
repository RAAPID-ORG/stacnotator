import type { Binding, HotkeyScope } from './types';

interface Registration {
  scope: HotkeyScope;
  table: Binding[];
}

const registrations: Registration[] = [];
let listenerInstalled = false;

/** Observers of "a binding just ran", by key spec. The guided tour needs to
 *  know the user pressed the key a step asks for, and reading raw keydowns
 *  would re-implement the matching (and the `when`/input-focus guards) this
 *  registry already owns. */
const bindingObservers = new Set<(key: string) => void>();

// Which scope wins when more than one has a matching, unguarded binding for
// the same physical key on the same event.
const SCOPE_PRECEDENCE: Record<HotkeyScope, number> = {
  global: 0,
  mode: 1,
  form: 2,
  drawing: 3,
};

const MODIFIER_NAMES = ['shift', 'alt', 'ctrl', 'meta'] as const;
type ModifierName = (typeof MODIFIER_NAMES)[number];

const MODIFIER_FLAGS: Record<ModifierName, (e: KeyboardEvent) => boolean> = {
  shift: (e) => e.shiftKey,
  alt: (e) => e.altKey,
  ctrl: (e) => e.ctrlKey,
  meta: (e) => e.metaKey,
};

/** Splits a spec like 'shift+a' into its base key and modifier tokens.
 *  Not trimmed: the literal space-key spec ' ' must survive as the base. */
function parseKeySpec(spec: string): { base: string; modifiers: string[] } {
  const parts = spec.split('+').map((p) => p.toLowerCase());
  return { base: parts[parts.length - 1], modifiers: parts.slice(0, -1) };
}

/** Canonical form used to detect two bindings that target the same physical
 *  key, independent of modifier token order (e.g. 'shift+a' === 'a+shift'). */
function canonicalKey(spec: string): string {
  const { base, modifiers } = parseKeySpec(spec);
  return [...modifiers].sort().join('+') + '|' + base;
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
};

/** Human-readable form of a key spec: 'shift+x' reads as 'Shift+X'. Lives with
 *  the registry because the spec format is the registry's, and every surface
 *  that shows a shortcut (help panel, button tooltips, guided tour) has to
 *  render it the same way. */
export function keyLabel(spec: string): string {
  return spec
    .split('+')
    .map((part) => KEY_NAMES[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join('+');
}

const DIGIT = /^[0-9]$/;

/**
 * Whether the physical key the user pressed is the one `base` names.
 *
 * `e.key` is the produced character, which on every non-US layout - and on a
 * US layout under Shift - is not the digit engraved on the key: Shift+1 emits
 * '!', so a 'shift+1' binding matched on `e.key` alone could never fire.
 * `e.code` names the physical key regardless of layout or modifiers, so digit
 * specs fall back to it.
 */
function matchesBase(e: KeyboardEvent, base: string): boolean {
  if (e.key.toLowerCase() === base) return true;
  return DIGIT.test(base) && e.code === `Digit${base}`;
}

export function matchKey(e: KeyboardEvent, key: string): boolean {
  const { base, modifiers } = parseKeySpec(key);
  if (!matchesBase(e, base)) return false;
  for (const name of MODIFIER_NAMES) {
    if (MODIFIER_FLAGS[name](e) !== modifiers.includes(name)) return false;
  }
  return true;
}

function isInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function handleKeyDown(e: KeyboardEvent): void {
  const typing = isInputTarget(e.target);
  let best: { precedence: number; binding: Binding } | null = null;

  for (const reg of registrations) {
    const precedence = SCOPE_PRECEDENCE[reg.scope];
    if (best && precedence <= best.precedence) continue;
    for (const binding of reg.table) {
      if (!matchKey(e, binding.key)) continue;
      if (e.repeat && !binding.allowRepeat) continue;
      if (typing && !binding.allowInInput) continue;
      if (binding.when && !binding.when()) continue;
      best = { precedence, binding };
      break; // duplicate keys within one scope are rejected at registration time
    }
  }

  if (best) {
    best.binding.run(e);
    e.preventDefault();
    for (const observe of bindingObservers) observe(best.binding.key);
  }
}

/** Subscribe to every binding that fires, by key spec. Returns an unsubscribe. */
export function onAnyBinding(cb: (key: string) => void): () => void {
  bindingObservers.add(cb);
  return () => {
    bindingObservers.delete(cb);
  };
}

function installListener(): void {
  if (listenerInstalled) return;
  window.addEventListener('keydown', handleKeyDown);
  listenerInstalled = true;
}

function uninstallListenerIfIdle(): void {
  if (registrations.length === 0 && listenerInstalled) {
    window.removeEventListener('keydown', handleKeyDown);
    listenerInstalled = false;
  }
}

/** Throws if `table` reuses a key already active in `scope`, either against
 *  itself or against another registration for that same scope. Cross-scope
 *  reuse is fine - that's what precedence resolves. */
function assertNoDuplicateKeys(scope: HotkeyScope, table: Binding[]): void {
  const seen = new Set<string>();
  for (const binding of table) {
    const canonical = canonicalKey(binding.key);
    if (seen.has(canonical)) {
      throw new Error(`duplicate hotkey "${binding.key}" registered twice in scope "${scope}"`);
    }
    seen.add(canonical);
  }
  for (const reg of registrations) {
    if (reg.scope !== scope) continue;
    for (const binding of reg.table) {
      if (seen.has(canonicalKey(binding.key))) {
        throw new Error(`duplicate hotkey "${binding.key}" already active in scope "${scope}"`);
      }
    }
  }
}

export function registerBindings(scope: HotkeyScope, table: Binding[]): () => void {
  assertNoDuplicateKeys(scope, table);

  const registration: Registration = { scope, table };
  registrations.push(registration);
  installListener();

  return () => {
    const index = registrations.indexOf(registration);
    if (index === -1) return;
    registrations.splice(index, 1);
    uninstallListenerIfIdle();
  };
}

export function getHelp(): Array<{ scope: HotkeyScope; key: string; help: string }> {
  const rows: Array<{ scope: HotkeyScope; key: string; help: string }> = [];
  for (const reg of registrations) {
    for (const binding of reg.table) {
      rows.push({ scope: reg.scope, key: binding.key, help: binding.help });
    }
  }
  return rows;
}
