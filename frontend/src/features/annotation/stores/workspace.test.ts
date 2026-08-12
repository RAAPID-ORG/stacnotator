import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_WORKSPACE_LAYOUT, useWorkspaceStore } from './workspace';

beforeEach(() => {
  useWorkspaceStore.setState({
    currentLayout: EMPTY_WORKSPACE_LAYOUT,
    savedLayout: EMPTY_WORKSPACE_LAYOUT,
    editing: false,
    newWindowSize: { perRow: 6, rows: 9 },
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
