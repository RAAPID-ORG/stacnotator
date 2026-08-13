import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCREEN_DEFAULT_BOUNDS, useLayoutStore } from '../../stores/layout';

/** The restore toast's own count, read off the same state it renders from. */
const restorable = () => {
  const { screens, savedScreens } = layout();
  if (screens.screens.length > 0 || !savedScreens) return 0;
  return Object.keys(savedScreens.assignment).length > 0 ? savedScreens.screens.length : 0;
};

const layout = () => useLayoutStore.getState();

const SCOPE = 'user-1:7';
const STORAGE_KEY = `annotation:screens:${SCOPE}`;
const ITEM = { i: 'minimap', x: 0, y: 0, w: 20, h: 12 };

beforeEach(() => {
  localStorage.clear();
  layout().setScope(SCOPE);
});

describe('screen split', () => {
  it('withholds a sent panel and gives it back when its screen closes', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));
    const screenId = layout().screens.screens[0].id;
    expect(Object.keys(layout().screens.assignment)).toEqual(['minimap']);

    // The blocked-popup path is exactly this: the window never opened, so it
    // closes, and the panel has to come back to the main canvas.
    act(() => layout().closeScreen(screenId));
    expect(Object.keys(layout().screens.assignment)).toEqual([]);
    expect(layout().screens.screens).toEqual([]);
  });

  it('seeds a new screen with the bounds it is opened at, so panels scale against a real width', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));

    expect(layout().screens.screens[0].bounds).toEqual(SCREEN_DEFAULT_BOUNDS);
  });

  it('remembers a screen window position', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));
    const screenId = layout().screens.screens[0].id;

    act(() =>
      layout().rememberScreenBounds(screenId, { width: 900, height: 700, left: 10, top: 20 })
    );

    expect(layout().screens.screens[0].bounds).toEqual({
      width: 900,
      height: 700,
      left: 10,
      top: 20,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').screens[0].bounds.width).toBe(900);
  });

  it('forgets the split once the last screen closes, instead of re-offering it', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => layout().closeScreen(layout().screens.screens[0].id));

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(restorable()).toBe(0);
  });

  it('offers a remembered split back, and does not overwrite it before the user acts', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ screens: [{ id: 2, layout: [ITEM] }], assignment: { minimap: 2 } })
    );
    act(() => layout().setScope(SCOPE));

    expect(restorable()).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => layout().restoreSavedScreens());
    expect(Object.keys(layout().screens.assignment)).toEqual(['minimap']);
    expect(restorable()).toBe(0);
  });

  it('holds nothing when there is no scope to hold it under', () => {
    act(() => layout().setScope(null));

    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));

    expect(localStorage.length).toBe(0);
  });
});
