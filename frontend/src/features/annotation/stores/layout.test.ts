import { beforeEach, describe, expect, it } from 'vitest';
import { makeCampaign, makeView } from '~/features/annotation/testing/fixtures';
import { useLayoutStore } from './layout';
import { coversPanels, EMPTY_LAYOUT, layoutForView, overlaps, toGridLayout } from '../canvas/grid';

const layoutOut = (id: number, keys: string[]) => ({
  id,
  user_id: null,
  layout_data: keys.map((key, index) => ({ i: key, x: index * 10, y: 30, w: 10, h: 9 })),
});

const chrome = layoutOut(1, ['main', 'minimap', 'controls']);

beforeEach(() => {
  useLayoutStore.setState({
    currentLayout: EMPTY_LAYOUT,
    savedLayout: EMPTY_LAYOUT,
    editing: false,
    newWindowSize: { perRow: 6, rows: 9 },
  });
});

describe('layoutForView', () => {
  it('takes the page chrome from the campaign and the windows from the view', () => {
    const campaign = makeCampaign({ default_main_canvas_layout: chrome });
    const view = makeView({ id: 1, default_canvas_layout: layoutOut(2, ['10', '20']) });

    const layout = layoutForView(campaign, view);
    expect(layout.main.main).toMatchObject({ i: 'main', x: 0 });
    expect(Object.keys(layout.windows)).toEqual(['10', '20']);
  });

  it('prefers the personal layout over the default on both halves', () => {
    const campaign = makeCampaign({
      default_main_canvas_layout: chrome,
      personal_main_canvas_layout: layoutOut(3, ['main', 'minimap', 'controls']),
    });
    const view = makeView({
      id: 1,
      default_canvas_layout: layoutOut(4, ['10']),
      personal_canvas_layout: layoutOut(5, ['20']),
    });

    const layout = layoutForView(campaign, view);
    expect(layout.main.minimap).toMatchObject({ i: 'minimap', x: 10 });
    expect(Object.keys(layout.windows)).toEqual(['20']);
  });

  it('leaves a view without any saved layout with no windows', () => {
    const layout = layoutForView(makeCampaign({ default_main_canvas_layout: chrome }), makeView());
    expect(layout.windows).toEqual({});
  });
});

describe('loadViewLayout', () => {
  it('swaps the windows and keeps the chrome the page already has', () => {
    const moved = {
      ...EMPTY_LAYOUT,
      main: {
        ...EMPTY_LAYOUT.main,
        main: { i: 'main', x: 3, y: 0, w: 40, h: 20, slice_navigation: true },
        timeline: { i: 'timeline', x: 0, y: 20, w: 40, h: 5, orientation: 'horizontal' as const },
      },
    };
    useLayoutStore.setState({ currentLayout: moved, savedLayout: moved });

    useLayoutStore
      .getState()
      .loadViewLayout(makeView({ id: 1, default_canvas_layout: layoutOut(2, ['10']) }));

    const { currentLayout, savedLayout } = useLayoutStore.getState();
    expect(currentLayout.main).toEqual(moved.main);
    expect(savedLayout.main).toEqual(moved.main);
    expect(Object.keys(currentLayout.windows)).toEqual(['10']);
    // Cancelling an edit made after the switch must not revert to the other view.
    expect(savedLayout.windows).toEqual(currentLayout.windows);
  });
});

describe('coversPanels', () => {
  it('rejects a change that drops panels the canvas is still rendering', () => {
    const rendered = ['main', 'minimap', '10'];
    expect(coversPanels([{ i: 'main', x: 0, y: 0, w: 1, h: 1 }], rendered)).toBe(false);
    expect(coversPanels([], rendered)).toBe(false);
  });

  it('accepts a change that carries every rendered panel', () => {
    const change = ['main', 'minimap', '10'].map((i) => ({ i, x: 0, y: 0, w: 1, h: 1 }));
    expect(coversPanels(change, ['main', 'minimap', '10'])).toBe(true);
    // A stale window in the layout that no panel renders must not block saving.
    expect(coversPanels(change, ['main', '10'])).toBe(true);
  });

  it('accepts any change while nothing is rendered', () => {
    expect(coversPanels([], [])).toBe(true);
  });
});

describe('showWindow / hideWindow / hideAllWindows', () => {
  it('hides a window, then shows it again', () => {
    useLayoutStore.getState().hideWindow(10);
    expect(useLayoutStore.getState().currentLayout.hidden).toEqual([10]);

    useLayoutStore.getState().showWindow(10);
    expect(useLayoutStore.getState().currentLayout.windows[10]).toBeDefined();
    expect(useLayoutStore.getState().currentLayout.hidden).toEqual([]);
  });

  it('showWindow is a no-op for a window that is not hidden', () => {
    const layout = useLayoutStore.getState().currentLayout;
    useLayoutStore.getState().showWindow(10);
    expect(useLayoutStore.getState().currentLayout).toBe(layout);
  });

  it('hideAllWindows hides every window it is given but keeps the main chrome', () => {
    useLayoutStore.getState().hideAllWindows([10, 20]);
    const layout = useLayoutStore.getState().currentLayout;
    expect(layout.windows).toEqual({});
    expect(layout.hidden).toEqual([10, 20]);
    expect(layout.main).toEqual(EMPTY_LAYOUT.main);
  });
});

describe('startEditing / saveLayout / cancelEditing', () => {
  it('docks the timeline beside or below the map without moving neighboring panels', () => {
    const initial = {
      ...EMPTY_LAYOUT,
      main: {
        ...EMPTY_LAYOUT.main,
        main: { i: 'main', x: 2, y: 3, w: 30, h: 20, slice_navigation: true },
        minimap: { i: 'minimap', x: 32, y: 3, w: 10, h: 20 },
      },
      windows: { 10: { i: '10', x: 2, y: 23, w: 30, h: 10 } },
    };
    useLayoutStore.setState({ currentLayout: initial, savedLayout: initial });
    const store = useLayoutStore.getState();
    store.setNavigationPanel('timeline', true);
    let layout = useLayoutStore.getState().currentLayout;
    expect(layout.main.timeline).toMatchObject({ i: 'timeline', x: 2, y: 3, w: 4, h: 20 });
    expect(layout.main.main).toMatchObject({ x: 6, y: 3, w: 26, h: 20, slice_navigation: true });

    store.setPanelOptions('timeline', { orientation: 'horizontal' });
    layout = useLayoutStore.getState().currentLayout;
    expect(layout.main.timeline).toMatchObject({
      x: 2,
      y: 21,
      w: 30,
      h: 2,
      orientation: 'horizontal',
    });
    expect(layout.main.main).toMatchObject({ x: 2, y: 3, w: 30, h: 18 });
    expect(layout.main.minimap).toEqual(initial.main.minimap);
    expect(layout.windows).toEqual(initial.windows);
    for (const item of toGridLayout(layout)) {
      expect(
        toGridLayout(layout).some((other) => other.i !== item.i && overlaps(item, other))
      ).toBe(false);
    }

    store.setPanelOptions('timeline', { orientation: 'vertical' });
    expect(useLayoutStore.getState().currentLayout.main.timeline).toMatchObject({
      x: 2,
      y: 3,
      w: 4,
      h: 20,
    });
    store.setNavigationPanel('timeline', false);
    expect(useLayoutStore.getState().currentLayout).toEqual(initial);
  });

  it('does not reclaim space between the map and a timeline the user moved away', () => {
    const initial = {
      ...EMPTY_LAYOUT,
      main: {
        ...EMPTY_LAYOUT.main,
        main: { i: 'main', x: 4, y: 0, w: 30, h: 20 },
        timeline: { i: 'timeline', x: 0, y: 50, w: 4, h: 20, orientation: 'vertical' as const },
      },
    };
    useLayoutStore.setState({ currentLayout: initial });
    useLayoutStore.getState().setNavigationPanel('timeline', false);
    expect(useLayoutStore.getState().currentLayout.main.main).toEqual(initial.main.main);
  });

  it('keeps a one-cell map intact when there is no room to split it', () => {
    const initial = {
      ...EMPTY_LAYOUT,
      main: { ...EMPTY_LAYOUT.main, main: { i: 'main', x: 0, y: 0, w: 1, h: 1 } },
    };
    useLayoutStore.setState({ currentLayout: initial });
    const store = useLayoutStore.getState();
    store.setNavigationPanel('timeline', true);
    store.setPanelOptions('timeline', { orientation: 'horizontal' });
    const { main } = useLayoutStore.getState().currentLayout;
    expect(main.main).toEqual(initial.main.main);
    expect(main.timeline?.w).toBeGreaterThan(0);
    expect(main.timeline?.h).toBeGreaterThan(0);
    expect(overlaps(main.main, main.timeline!)).toBe(false);
  });

  it('packs detached navigation without overlap and reverts all its settings on cancel', () => {
    const initial = layoutForView(makeCampaign({ default_main_canvas_layout: chrome }), makeView());
    useLayoutStore.setState({ currentLayout: initial, savedLayout: initial });
    const store = useLayoutStore.getState();
    store.startEditing();
    store.setNavigationPanel('timeline', true);
    store.setNavigationPanel('imagery', true);
    store.setPanelOptions('timeline', { orientation: 'horizontal' });
    store.setPanelOptions('imagery', {
      orientation: 'vertical',
      expanded_sections: ['sources', 'visualizations'],
    });
    store.setPanelOptions('main', { slice_navigation: true });
    const edited = useLayoutStore.getState().currentLayout;
    for (const item of toGridLayout(edited)) {
      expect(
        toGridLayout(edited)
          .filter((other) => other.i !== item.i)
          .some((other) => overlaps(item, other))
      ).toBe(false);
    }
    store.setNavigationPanel('timeline', false);
    expect(useLayoutStore.getState().currentLayout.main.timeline).toBeUndefined();
    store.cancelEditing();
    expect(useLayoutStore.getState().currentLayout).toEqual(initial);
  });

  it('cancelEditing reverts currentLayout to savedLayout and clears editing', () => {
    useLayoutStore.getState().startEditing();
    expect(useLayoutStore.getState().editing).toBe(true);

    useLayoutStore.getState().hideWindow(10);
    useLayoutStore.getState().showWindow(10);
    expect(useLayoutStore.getState().currentLayout.windows[10]).toBeDefined();

    useLayoutStore.getState().cancelEditing();
    expect(useLayoutStore.getState().editing).toBe(false);
    expect(useLayoutStore.getState().currentLayout).toEqual(EMPTY_LAYOUT);
    expect(useLayoutStore.getState().currentLayout.windows[10]).toBeUndefined();
  });

  it('saveLayout commits currentLayout into savedLayout and clears editing', () => {
    useLayoutStore.getState().startEditing();
    useLayoutStore.getState().hideWindow(10);
    useLayoutStore.getState().showWindow(10);
    const editedLayout = useLayoutStore.getState().currentLayout;

    useLayoutStore.getState().saveLayout();
    expect(useLayoutStore.getState().editing).toBe(false);
    expect(useLayoutStore.getState().savedLayout).toEqual(editedLayout);

    // A subsequent cancel now reverts to the newly-saved layout, not the original.
    useLayoutStore.getState().startEditing();
    useLayoutStore.getState().hideWindow(10);
    useLayoutStore.getState().cancelEditing();
    expect(useLayoutStore.getState().currentLayout.windows[10]).toBeDefined();
  });
});

describe('setNewWindowSize', () => {
  it('sizes newly-shown windows using the configured perRow/rows', () => {
    useLayoutStore.getState().setNewWindowSize({ perRow: 3, rows: 12 });
    useLayoutStore.getState().hideWindow(10);
    useLayoutStore.getState().showWindow(10);
    expect(useLayoutStore.getState().currentLayout.windows[10]).toMatchObject({
      w: 20,
      h: 12,
    });
  });
});

describe('sendToScreen', () => {
  it('opens a timeline-only screen as a full-width horizontal strip', () => {
    useLayoutStore.getState().setScope('test');
    useLayoutStore.getState().sendToScreen('timeline', 'new', undefined, 1200);
    const [screen] = useLayoutStore.getState().screens.screens;
    expect(screen.layout).toEqual([expect.objectContaining({ i: 'timeline', w: 60, h: 2 })]);
    expect(screen.bounds?.height).toBeLessThan(200);
  });
});
