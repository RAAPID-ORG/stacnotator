import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHotkeys } from './hotkeys';

function focusedInput(type: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  document.body.append(input);
  return input;
}

const press = (target: HTMLElement, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('hotkeys over a focused control', () => {
  const run = vi.fn();

  function bind(key: string) {
    run.mockReset();
    return renderHook(() => useHotkeys([{ key, run }], []));
  }

  it('still fires from a checkbox, which is not text entry', () => {
    bind('e');
    press(focusedInput('checkbox'), 'e');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('leaves Space to the checkbox it toggles', () => {
    bind(' ');
    press(focusedInput('checkbox'), ' ');
    expect(run).not.toHaveBeenCalled();
  });

  it('stays out of a text field', () => {
    bind('e');
    press(focusedInput('text'), 'e');
    expect(run).not.toHaveBeenCalled();
  });
});
