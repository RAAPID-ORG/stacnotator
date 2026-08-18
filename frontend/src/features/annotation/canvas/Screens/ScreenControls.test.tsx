import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCREEN_DEFAULT_BOUNDS, useLayoutStore, useRestorableScreens } from '../../stores/layout';
import { SendToScreenButton, type ScreenTarget } from './ScreenControls';

/** What the restore chip would show right now. */
const restorable = () => renderHook(() => useRestorableScreens()).result.current;

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

  it('offers the split back once the last screen closes, so a close is undoable', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));

    act(() => layout().closeScreen(layout().screens.screens[0].id));

    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(restorable()).toBe(1);

    act(() => layout().restoreSavedScreens());
    expect(layout().screens.assignment).toEqual({ minimap: 2 });
  });

  it('hides the offer for this visit without forgetting the split', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));
    act(() => layout().closeScreen(layout().screens.screens[0].id));

    act(() => layout().hideRestorePrompt());
    expect(restorable()).toBe(0);

    // Coming back to the campaign offers it again.
    act(() => layout().setScope(SCOPE));
    expect(restorable()).toBe(1);
  });

  it('forgets the split when a layout is saved with no screen in use', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));
    act(() => layout().closeScreen(layout().screens.screens[0].id));

    act(() => layout().saveLayout());

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(restorable()).toBe(0);
  });

  it('keeps the split when a layout is saved while a screen is in use', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));

    act(() => layout().saveLayout());

    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
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

  it('sends one card back to the main canvas, leaving the screen open', () => {
    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));
    act(() => layout().sendToScreen('controls', 2, ITEM, 1200));

    act(() => layout().returnPanelToMain('minimap'));

    expect(layout().screens.assignment).toEqual({ controls: 2 });
    expect(layout().screens.screens[0].layout.map((it) => it.i)).toEqual(['controls']);
  });

  it('holds nothing when there is no scope to hold it under', () => {
    act(() => layout().setScope(null));

    act(() => layout().sendToScreen('minimap', 'new', ITEM, 1200));

    expect(localStorage.length).toBe(0);
  });
});

describe('the card header move control', () => {
  const renderButton = (props: Partial<Parameters<typeof SendToScreenButton>[0]>) => {
    const sent: ScreenTarget[] = [];
    render(
      <SendToScreenButton
        panelId="minimap"
        label="Minimap"
        screenIds={[]}
        onSend={(target) => sent.push(target)}
        {...props}
      />
    );
    return sent;
  };

  it('opens a screen straight away when there is nowhere else for a card to go', async () => {
    const sent = renderButton({});

    await userEvent.click(screen.getByTestId('send-to-screen-minimap'));

    expect(sent).toEqual(['new']);
  });

  it('offers a card on a screen its way back, and the screens it is not on', async () => {
    const sent = renderButton({ screenIds: [2, 3], currentScreen: 2 });

    await userEvent.click(screen.getByTestId('send-to-screen-minimap'));
    expect(screen.queryByTestId('send-to-screen-minimap-2')).toBeNull();
    expect(screen.getByTestId('send-to-screen-minimap-3')).toBeTruthy();

    await userEvent.click(screen.getByTestId('send-to-screen-minimap-main'));
    expect(sent).toEqual(['main']);
  });

  it('keeps the main window out of the menu for a card that is already there', async () => {
    renderButton({ screenIds: [2] });

    await userEvent.click(screen.getByTestId('send-to-screen-minimap'));

    expect(screen.queryByTestId('send-to-screen-minimap-main')).toBeNull();
    expect(screen.getByTestId('send-to-screen-minimap-2')).toBeTruthy();
  });
});
