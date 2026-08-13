import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCREEN_DEFAULT_BOUNDS, useScreens } from './screens';

const SCOPE = 'user-1:7';
const STORAGE_KEY = `annotation:screens:${SCOPE}`;
const ITEM = { i: 'minimap', x: 0, y: 0, w: 20, h: 12 };

beforeEach(() => {
  localStorage.clear();
});

describe('useScreens', () => {
  it('withholds a sent panel and gives it back when its screen closes', () => {
    const { result } = renderHook(() => useScreens(SCOPE));

    act(() => result.current.send('minimap', 'new', ITEM, 1200));
    const screenId = result.current.state.screens[0].id;
    expect([...result.current.popped]).toEqual(['minimap']);

    // The blocked-popup path is exactly this: the window never opened, so it
    // closes, and the panel has to come back to the main canvas.
    act(() => result.current.close(screenId));
    expect([...result.current.popped]).toEqual([]);
    expect(result.current.state.screens).toEqual([]);
  });

  it('seeds a new screen with the bounds it is opened at, so panels scale against a real width', () => {
    const { result } = renderHook(() => useScreens(SCOPE));

    act(() => result.current.send('minimap', 'new', ITEM, 1200));

    expect(result.current.state.screens[0].bounds).toEqual(SCREEN_DEFAULT_BOUNDS);
  });

  it('remembers a screen window position', () => {
    const { result } = renderHook(() => useScreens(SCOPE));
    act(() => result.current.send('minimap', 'new', ITEM, 1200));
    const screenId = result.current.state.screens[0].id;

    act(() =>
      result.current.rememberBounds(screenId, { width: 900, height: 700, left: 10, top: 20 })
    );

    expect(result.current.state.screens[0].bounds).toEqual({
      width: 900,
      height: 700,
      left: 10,
      top: 20,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').screens[0].bounds.width).toBe(900);
  });

  it('forgets the split once the last screen closes, instead of re-offering it', () => {
    const { result } = renderHook(() => useScreens(SCOPE));

    act(() => result.current.send('minimap', 'new', ITEM, 1200));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => result.current.close(result.current.state.screens[0].id));

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.restorable).toBe(0);
  });

  it('offers a remembered split back, and does not overwrite it before the user acts', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ screens: [{ id: 2, layout: [ITEM] }], assignment: { minimap: 2 } })
    );

    const { result } = renderHook(() => useScreens(SCOPE));

    expect(result.current.restorable).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => result.current.restoreSaved());
    expect([...result.current.popped]).toEqual(['minimap']);
    expect(result.current.restorable).toBe(0);
  });

  it('holds nothing when there is no scope to hold it under', () => {
    const { result } = renderHook(() => useScreens(null));

    act(() => result.current.send('minimap', 'new', ITEM, 1200));

    expect(localStorage.length).toBe(0);
  });
});
