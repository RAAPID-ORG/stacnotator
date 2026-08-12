import { describe, it, expect } from 'vitest';
import type { WorkspaceLayout } from './types';
import { defaultWindowItem, hideAll, hideWindow, mainLayoutChanged, showWindow } from './layouts';

const baseLayout = (): WorkspaceLayout => ({
  main: {
    main: { i: 'main', x: 0, y: 0, w: 60, h: 20 },
    minimap: { i: 'minimap', x: 0, y: 20, w: 20, h: 10 },
    controls: { i: 'controls', x: 40, y: 20, w: 20, h: 10 },
    timeseries: {},
  },
  view: { windows: {} },
});

describe('mainLayoutChanged', () => {
  it('is false when the two layouts have an identical main part', () => {
    const a = baseLayout();
    const b = baseLayout();
    expect(mainLayoutChanged(a, b)).toBe(false);
  });

  it('is true when the main map item moved', () => {
    const a = baseLayout();
    const b = { ...a, main: { ...a.main, main: { ...a.main.main, x: 5 } } };
    expect(mainLayoutChanged(a, b)).toBe(true);
  });

  // A hand-written chrome-key predicate is easy to write without 'controls',
  // which silently skips the "applies to all views" warning when only the
  // controls panel moves. MainLayout's typed 'controls' field makes that
  // unrepresentable - a controls-only move must be detected here.
  it('detects a controls-only move', () => {
    const a = baseLayout();
    const b = { ...a, main: { ...a.main, controls: { ...a.main.controls, x: 45 } } };
    expect(mainLayoutChanged(a, b)).toBe(true);
  });

  it('is false when only the view windows differ (main part untouched)', () => {
    const a = baseLayout();
    const b: WorkspaceLayout = {
      ...a,
      view: { windows: { 5: { i: '5', x: 0, y: 0, w: 10, h: 9 } } },
    };
    expect(mainLayoutChanged(a, b)).toBe(false);
  });
});

describe('hideWindow / showWindow / hideAll', () => {
  it('showWindow packs a window beside the last one on its row when there is room', () => {
    const withOne: WorkspaceLayout = {
      ...baseLayout(),
      view: { windows: { 1: { i: '1', x: 0, y: 30, w: 10, h: 9 } } },
    };
    const next = showWindow(withOne, 2, { w: 10, h: 9 });
    expect(next.view.windows[2]).toEqual({ i: '2', x: 10, y: 30, w: 10, h: 9 });
  });

  it('showWindow starts a new row when the current row is full', () => {
    const full: WorkspaceLayout = {
      ...baseLayout(),
      view: { windows: { 1: { i: '1', x: 0, y: 30, w: 60, h: 9 } } },
    };
    const next = showWindow(full, 2, { w: 10, h: 9 });
    expect(next.view.windows[2]).toEqual({ i: '2', x: 0, y: 39, w: 10, h: 9 });
  });

  it('showWindow on an empty view sits flush below the main chrome', () => {
    const next = showWindow(baseLayout(), 1, { w: 10, h: 9 });
    // Chrome bottom is max(main:0+20, minimap:20+10, controls:20+10) = 30.
    expect(next.view.windows[1]).toEqual({ i: '1', x: 0, y: 30, w: 10, h: 9 });
  });

  it('hideWindow removes just that collection from the view', () => {
    const layout: WorkspaceLayout = {
      ...baseLayout(),
      view: {
        windows: {
          1: { i: '1', x: 0, y: 30, w: 10, h: 9 },
          2: { i: '2', x: 10, y: 30, w: 10, h: 9 },
        },
      },
    };
    const next = hideWindow(layout, 1);
    expect(next.view.windows).toEqual({ 2: { i: '2', x: 10, y: 30, w: 10, h: 9 } });
  });

  it('hideAll clears every window but keeps the main chrome untouched', () => {
    const layout: WorkspaceLayout = {
      ...baseLayout(),
      view: {
        windows: {
          1: { i: '1', x: 0, y: 30, w: 10, h: 9 },
          2: { i: '2', x: 10, y: 30, w: 10, h: 9 },
        },
      },
    };
    const next = hideAll(layout);
    expect(next.view.windows).toEqual({});
    expect(next.main).toEqual(layout.main);
  });
});

describe('defaultWindowItem', () => {
  it('divides the grid width evenly across the requested columns per row', () => {
    expect(defaultWindowItem(6, 9)).toEqual({ w: 10, h: 9 });
  });

  it('floors an uneven division', () => {
    expect(defaultWindowItem(4, 5)).toEqual({ w: 15, h: 5 });
  });
});
