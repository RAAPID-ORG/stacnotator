import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOutside, useDismissOnOutside } from './useDismissOnOutside';

function mount(tag = 'div'): HTMLElement {
  const element = document.createElement(tag);
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isOutside', () => {
  it('treats an element and its descendants as inside', () => {
    const panel = mount();
    const child = mount('button');
    panel.appendChild(child);

    expect(isOutside(panel, [panel])).toBe(false);
    expect(isOutside(child, [panel])).toBe(false);
    expect(isOutside(mount(), [panel])).toBe(true);
  });

  it('accepts any of several elements, ignoring unmounted refs', () => {
    const trigger = mount('button');
    const portalled = mount();

    expect(isOutside(portalled, [null, trigger, portalled])).toBe(false);
    expect(isOutside(mount(), [null, trigger, portalled])).toBe(true);
  });

  it('dismisses on a target that is not an element', () => {
    expect(isOutside(null, [mount()])).toBe(true);
  });
});

describe('useDismissOnOutside', () => {
  const press = (target: EventTarget) =>
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  it('dismisses on an outside pointerdown but not an inside one', () => {
    const container = mount();
    const ref: RefObject<HTMLElement | null> = { current: container };
    const onDismiss = vi.fn();

    renderHook(() => useDismissOnOutside(ref, onDismiss, true));

    press(container);
    expect(onDismiss).not.toHaveBeenCalled();

    press(mount());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape only', () => {
    const ref: RefObject<HTMLElement | null> = { current: mount() };
    const onDismiss = vi.fn();

    renderHook(() => useDismissOnOutside(ref, onDismiss, true));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays silent while disabled and after unmount', () => {
    const ref: RefObject<HTMLElement | null> = { current: mount() };
    const onDismiss = vi.fn();

    const disabled = renderHook(() => useDismissOnOutside(ref, onDismiss, false));
    press(mount());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();
    disabled.unmount();

    const enabled = renderHook(() => useDismissOnOutside(ref, onDismiss, true));
    enabled.unmount();
    press(mount());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('calls the latest callback without re-binding', () => {
    const ref: RefObject<HTMLElement | null> = { current: mount() };
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ onDismiss }: { onDismiss: () => void }) => useDismissOnOutside(ref, onDismiss, true),
      { initialProps: { onDismiss: first } }
    );
    rerender({ onDismiss: second });

    press(mount());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
