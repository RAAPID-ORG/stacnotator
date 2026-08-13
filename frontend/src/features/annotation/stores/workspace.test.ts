import { beforeEach, describe, expect, it } from 'vitest';
import { makeCampaign, makeView } from '~/features/annotation/core/catalog/testHelpers';
import {
  coversPanels,
  EMPTY_WORKSPACE_LAYOUT,
  layoutForView,
  useWorkspaceStore,
} from './workspace';

const layoutOut = (id: number, keys: string[]) => ({
  id,
  user_id: null,
  layout_data: keys.map((key, index) => ({ i: key, x: index * 10, y: 30, w: 10, h: 9 })),
});

const chrome = layoutOut(1, ['main', 'minimap', 'controls']);

beforeEach(() => {
  useWorkspaceStore.setState({
    currentLayout: EMPTY_WORKSPACE_LAYOUT,
    savedLayout: EMPTY_WORKSPACE_LAYOUT,
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
    expect(Object.keys(layout.view.windows)).toEqual(['10', '20']);
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
    expect(Object.keys(layout.view.windows)).toEqual(['20']);
  });

  it('leaves a view without any saved layout with no windows', () => {
    const layout = layoutForView(makeCampaign({ default_main_canvas_layout: chrome }), makeView());
    expect(layout.view.windows).toEqual({});
  });
});

describe('loadViewLayout', () => {
  it('swaps the windows and keeps the chrome the page already has', () => {
    const moved = {
      ...EMPTY_WORKSPACE_LAYOUT,
      main: {
        ...EMPTY_WORKSPACE_LAYOUT.main,
        main: { i: 'main', x: 3, y: 0, w: 40, h: 20 },
      },
    };
    useWorkspaceStore.setState({ currentLayout: moved, savedLayout: moved });

    useWorkspaceStore
      .getState()
      .loadViewLayout(makeView({ id: 1, default_canvas_layout: layoutOut(2, ['10']) }));

    const { currentLayout, savedLayout } = useWorkspaceStore.getState();
    expect(currentLayout.main.main).toEqual(moved.main.main);
    expect(Object.keys(currentLayout.view.windows)).toEqual(['10']);
    // Cancelling an edit made after the switch must not revert to the other view.
    expect(savedLayout.view.windows).toEqual(currentLayout.view.windows);
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
  it('shows a window, then hides it', () => {
    useWorkspaceStore.getState().showWindow(10);
    expect(useWorkspaceStore.getState().currentLayout.view.windows[10]).toBeDefined();

    useWorkspaceStore.getState().hideWindow(10);
    expect(useWorkspaceStore.getState().currentLayout.view.windows[10]).toBeUndefined();
  });

  it('showWindow is a no-op when the window is already present (same reference in, packed once)', () => {
    useWorkspaceStore.getState().showWindow(10);
    const layout = useWorkspaceStore.getState().currentLayout;
    useWorkspaceStore.getState().showWindow(10);
    expect(useWorkspaceStore.getState().currentLayout).toBe(layout);
  });

  it('hideAllWindows clears every window but keeps the main chrome', () => {
    useWorkspaceStore.getState().showWindow(10);
    useWorkspaceStore.getState().showWindow(20);
    useWorkspaceStore.getState().hideAllWindows();
    const layout = useWorkspaceStore.getState().currentLayout;
    expect(layout.view.windows).toEqual({});
    expect(layout.main).toEqual(EMPTY_WORKSPACE_LAYOUT.main);
  });
});

describe('startEditing / saveLayout / cancelEditing', () => {
  it('cancelEditing reverts currentLayout to savedLayout and clears editing', () => {
    useWorkspaceStore.getState().startEditing();
    expect(useWorkspaceStore.getState().editing).toBe(true);

    useWorkspaceStore.getState().showWindow(10);
    expect(useWorkspaceStore.getState().currentLayout.view.windows[10]).toBeDefined();

    useWorkspaceStore.getState().cancelEditing();
    expect(useWorkspaceStore.getState().editing).toBe(false);
    expect(useWorkspaceStore.getState().currentLayout).toEqual(EMPTY_WORKSPACE_LAYOUT);
    expect(useWorkspaceStore.getState().currentLayout.view.windows[10]).toBeUndefined();
  });

  it('saveLayout commits currentLayout into savedLayout and clears editing', () => {
    useWorkspaceStore.getState().startEditing();
    useWorkspaceStore.getState().showWindow(10);
    const editedLayout = useWorkspaceStore.getState().currentLayout;

    useWorkspaceStore.getState().saveLayout();
    expect(useWorkspaceStore.getState().editing).toBe(false);
    expect(useWorkspaceStore.getState().savedLayout).toEqual(editedLayout);

    // A subsequent cancel now reverts to the newly-saved layout, not the original.
    useWorkspaceStore.getState().startEditing();
    useWorkspaceStore.getState().hideWindow(10);
    useWorkspaceStore.getState().cancelEditing();
    expect(useWorkspaceStore.getState().currentLayout.view.windows[10]).toBeDefined();
  });
});

describe('setNewWindowSize', () => {
  it('sizes newly-shown windows using the configured perRow/rows', () => {
    useWorkspaceStore.getState().setNewWindowSize({ perRow: 3, rows: 12 });
    useWorkspaceStore.getState().showWindow(10);
    expect(useWorkspaceStore.getState().currentLayout.view.windows[10]).toMatchObject({
      w: 20,
      h: 12,
    });
  });
});
