import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHelp, registerBindings } from './registry';
import type { Binding } from './types';

// Registrations live in module-level state (mirrors the real single-listener
// design), so every test unregisters its own bindings via the returned
// unregister function and this sweeps up anything a failing test left behind.
const unregisterFns: Array<() => void> = [];
function register(scope: Parameters<typeof registerBindings>[0], table: Binding[]) {
  const unregister = registerBindings(scope, table);
  unregisterFns.push(unregister);
  return unregister;
}

afterEach(() => {
  while (unregisterFns.length > 0) unregisterFns.pop()!();
});

function dispatchKeydown(init: KeyboardEventInit & { target?: EventTarget }) {
  const { target, ...eventInit } = init;
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...eventInit });
  (target ?? window).dispatchEvent(event);
  return event;
}

describe('registerBindings lifecycle', () => {
  it('installs a single window keydown listener on first registration and removes it on last unregistration', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const unregisterA = register('global', [{ key: 'a', help: 'A', run: vi.fn() }]);
    const keydownAddCalls = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownAddCalls).toHaveLength(1);

    const unregisterB = register('global', [{ key: 'b', help: 'B', run: vi.fn() }]);
    const keydownAddCallsAfterSecond = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownAddCallsAfterSecond).toHaveLength(1); // still just one listener

    unregisterA();
    expect(removeSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);

    unregisterB();
    expect(removeSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('stops running a binding once it has been unregistered', () => {
    const run = vi.fn();
    const unregister = register('global', [{ key: 'a', help: 'A', run }]);
    dispatchKeydown({ key: 'a' });
    expect(run).toHaveBeenCalledTimes(1);

    unregister();
    dispatchKeydown({ key: 'a' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('scope precedence', () => {
  it('runs only the highest-precedence scope: drawing > form > mode > global', () => {
    const modeRun = vi.fn();
    const drawingRun = vi.fn();
    register('mode', [{ key: 'a', help: 'mode a', run: modeRun }]);
    register('drawing', [{ key: 'a', help: 'drawing a', run: drawingRun }]);

    dispatchKeydown({ key: 'a' });

    expect(drawingRun).toHaveBeenCalledTimes(1);
    expect(modeRun).not.toHaveBeenCalled();
  });

  it('falls back to a lower scope once the higher scope unregisters', () => {
    const modeRun = vi.fn();
    const drawingRun = vi.fn();
    register('mode', [{ key: 'a', help: 'mode a', run: modeRun }]);
    const unregisterDrawing = register('drawing', [
      { key: 'a', help: 'drawing a', run: drawingRun },
    ]);

    unregisterDrawing();
    dispatchKeydown({ key: 'a' });

    expect(drawingRun).not.toHaveBeenCalled();
    expect(modeRun).toHaveBeenCalledTimes(1);
  });
});

describe('when gating', () => {
  it('skips a binding whose when() returns false, and runs it once when() returns true', () => {
    let active = false;
    const run = vi.fn();
    register('global', [{ key: 'a', help: 'A', when: () => active, run }]);

    dispatchKeydown({ key: 'a' });
    expect(run).not.toHaveBeenCalled();

    active = true;
    dispatchKeydown({ key: 'a' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('key matching', () => {
  it('disambiguates shift+a from plain a', () => {
    const plainRun = vi.fn();
    const shiftRun = vi.fn();
    register('global', [
      { key: 'a', help: 'plain a', run: plainRun },
      { key: 'shift+a', help: 'shift a', run: shiftRun },
    ]);

    dispatchKeydown({ key: 'a', shiftKey: false });
    expect(plainRun).toHaveBeenCalledTimes(1);
    expect(shiftRun).not.toHaveBeenCalled();

    dispatchKeydown({ key: 'A', shiftKey: true });
    expect(plainRun).toHaveBeenCalledTimes(1);
    expect(shiftRun).toHaveBeenCalledTimes(1);
  });

  it('matches a digit spec on the physical key, so shift+<digit> fires on any layout', () => {
    const run = vi.fn();
    register('global', [{ key: 'shift+1', help: 'confidence 1', run }]);

    // A US layout emits '!'; a German one emits '!' too but from another key;
    // what every layout agrees on is e.code.
    dispatchKeydown({ key: '!', code: 'Digit1', shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps a plain digit binding off shift+<digit>', () => {
    const plainRun = vi.fn();
    const shiftRun = vi.fn();
    register('global', [
      { key: '1', help: 'label 1', run: plainRun },
      { key: 'shift+1', help: 'confidence 1', run: shiftRun },
    ]);

    dispatchKeydown({ key: '1', code: 'Digit1', shiftKey: false });
    expect(plainRun).toHaveBeenCalledTimes(1);
    expect(shiftRun).not.toHaveBeenCalled();

    dispatchKeydown({ key: '!', code: 'Digit1', shiftKey: true });
    expect(plainRun).toHaveBeenCalledTimes(1);
    expect(shiftRun).toHaveBeenCalledTimes(1);
  });
});

describe('input-element suppression', () => {
  let textarea: HTMLTextAreaElement;

  beforeEach(() => {
    textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
  });

  afterEach(() => {
    textarea.remove();
  });

  it('does not run a binding without allowInInput when the event target is a textarea', () => {
    const run = vi.fn();
    register('global', [{ key: 'a', help: 'A', run }]);

    dispatchKeydown({ key: 'a', target: textarea });

    expect(run).not.toHaveBeenCalled();
  });

  it('runs a binding with allowInInput true even when typing in a textarea', () => {
    const run = vi.fn();
    register('global', [{ key: 'a', help: 'A', run, allowInInput: true }]);

    dispatchKeydown({ key: 'a', target: textarea });

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('repeat suppression', () => {
  it('does not run a binding without allowRepeat on a repeat keydown', () => {
    const run = vi.fn();
    register('global', [{ key: 'a', help: 'A', run }]);

    dispatchKeydown({ key: 'a', repeat: true });

    expect(run).not.toHaveBeenCalled();
  });

  it('runs a binding with allowRepeat true on a repeat keydown', () => {
    const run = vi.fn();
    register('global', [{ key: 'a', help: 'A', run, allowRepeat: true }]);

    dispatchKeydown({ key: 'a', repeat: true });

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('preventDefault', () => {
  it('calls preventDefault only when a binding actually ran', () => {
    register('global', [{ key: 'a', help: 'A', run: vi.fn() }]);

    const ran = dispatchKeydown({ key: 'a' });
    expect(ran.defaultPrevented).toBe(true);

    const notRan = dispatchKeydown({ key: 'z' });
    expect(notRan.defaultPrevented).toBe(false);
  });
});

describe('getHelp', () => {
  it('returns registered help rows keyed by scope', () => {
    register('global', [{ key: 'a', help: 'Toggle A', run: vi.fn() }]);
    register('mode', [{ key: 'b', help: 'Toggle B', run: vi.fn() }]);

    expect(getHelp()).toEqual(
      expect.arrayContaining([
        { scope: 'global', key: 'a', help: 'Toggle A' },
        { scope: 'mode', key: 'b', help: 'Toggle B' },
      ])
    );
  });
});

describe('getHelp digit ranges', () => {
  it('collapses a run of digit bindings sharing help text into one row', () => {
    register(
      'mode',
      ['1', '2', '3', '4', '5'].map((key) => ({
        key,
        help: 'Select label by number',
        run: vi.fn(),
      }))
    );

    expect(getHelp()).toEqual([{ scope: 'mode', key: '1-5', help: 'Select label by number' }]);
  });

  it('reflects the number of keys actually bound, not a fixed 1-9', () => {
    register(
      'mode',
      ['1', '2', '3'].map((key) => ({ key, help: 'Select label by number', run: vi.fn() }))
    );

    expect(getHelp()).toEqual([{ scope: 'mode', key: '1-3', help: 'Select label by number' }]);
  });

  it('groups modifier and base together, e.g. shift+1..shift+5 becomes shift+1-5', () => {
    register(
      'mode',
      ([1, 2, 3, 4, 5] as const).map((level) => ({
        key: `shift+${level}`,
        help: 'Set confidence level',
        run: vi.fn(),
      }))
    );

    expect(getHelp()).toEqual([{ scope: 'mode', key: 'shift+1-5', help: 'Set confidence level' }]);
  });

  it('leaves non-digit bindings, and lone digit bindings, as individual rows', () => {
    register('global', [
      { key: 'a', help: 'Pan tool', run: vi.fn() },
      { key: 'r', help: 'Annotate tool', run: vi.fn() },
      { key: '1', help: 'Select label by number', run: vi.fn() },
    ]);

    expect(getHelp()).toEqual(
      expect.arrayContaining([
        { scope: 'global', key: 'a', help: 'Pan tool' },
        { scope: 'global', key: 'r', help: 'Annotate tool' },
        { scope: 'global', key: '1', help: 'Select label by number' },
      ])
    );
  });

  it('does not merge digit bindings that carry different help text', () => {
    register('form', [
      { key: '1', help: 'Answer the focused field', run: vi.fn() },
      { key: '2', help: 'A special second option', run: vi.fn() },
    ]);

    expect(getHelp()).toEqual(
      expect.arrayContaining([
        { scope: 'form', key: '1', help: 'Answer the focused field' },
        { scope: 'form', key: '2', help: 'A special second option' },
      ])
    );
  });
});

describe('duplicate keys', () => {
  it('throws when a single table registers the same key twice in one scope', () => {
    expect(() =>
      register('global', [
        { key: 'a', help: 'first', run: vi.fn() },
        { key: 'a', help: 'second', run: vi.fn() },
      ])
    ).toThrow(/duplicate/i);
  });

  it('throws when a second registration reuses a key already active in the same scope', () => {
    register('mode', [{ key: 'a', help: 'first', run: vi.fn() }]);
    expect(() => register('mode', [{ key: 'a', help: 'second', run: vi.fn() }])).toThrow(
      /duplicate/i
    );
  });

  it('allows the same key in different scopes', () => {
    expect(() => {
      register('mode', [{ key: 'a', help: 'mode a', run: vi.fn() }]);
      register('drawing', [{ key: 'a', help: 'drawing a', run: vi.fn() }]);
    }).not.toThrow();
  });
});
