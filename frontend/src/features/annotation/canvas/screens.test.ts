import { describe, expect, it } from 'vitest';
import {
  EMPTY_SCREENS,
  closeScreen,
  openScreen,
  rememberScreenBounds,
  returnPanelFromScreen,
  sendToScreen,
} from './screens';

describe('open', () => {
  it('assigns a fresh id and adds an empty screen', () => {
    const { state, id } = openScreen(EMPTY_SCREENS);
    expect(state.screens).toEqual([{ id, layout: [] }]);
  });

  it('assigns increasing ids across successive opens', () => {
    const first = openScreen(EMPTY_SCREENS);
    const second = openScreen(first.state);
    expect(second.id).toBeGreaterThan(first.id);
    expect(second.state.screens.map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it('is a no-op when opening an id that already exists', () => {
    const first = openScreen(EMPTY_SCREENS);
    const again = openScreen(first.state, first.id);
    expect(again.state).toBe(first.state);
    expect(again.id).toBe(first.id);
  });
});

describe('sendTo', () => {
  it('assigns a panel into an existing screen, packing its layout', () => {
    const { state, id } = openScreen(EMPTY_SCREENS);
    const next = sendToScreen(state, 'panel-a', id, { w: 10, h: 9 });
    expect(next.assignment).toEqual({ 'panel-a': id });
    expect(next.screens.find((s) => s.id === id)?.layout).toContainEqual({
      i: 'panel-a',
      x: 0,
      y: 0,
      w: 10,
      h: 9,
    });
  });

  it('is a no-op when the target screen does not exist', () => {
    expect(sendToScreen(EMPTY_SCREENS, 'panel-a', 99, { w: 10, h: 9 })).toBe(EMPTY_SCREENS);
  });

  it('moving a panel between screens removes it from its previous screen layout', () => {
    const opened1 = openScreen(EMPTY_SCREENS);
    const opened2 = openScreen(opened1.state);
    const onFirst = sendToScreen(opened2.state, 'panel-a', opened1.id, { w: 10, h: 9 });
    const onSecond = sendToScreen(onFirst, 'panel-a', opened2.id, { w: 10, h: 9 });
    expect(onSecond.assignment).toEqual({ 'panel-a': opened2.id });
    expect(onSecond.screens.find((s) => s.id === opened1.id)?.layout).toEqual([]);
    expect(onSecond.screens.find((s) => s.id === opened2.id)?.layout).toContainEqual({
      i: 'panel-a',
      x: 0,
      y: 0,
      w: 10,
      h: 9,
    });
  });
});

describe('close', () => {
  it('removes the screen and returns its panels (unassigns them)', () => {
    const { state, id } = openScreen(EMPTY_SCREENS);
    const withPanel = sendToScreen(state, 'panel-a', id, { w: 10, h: 9 });
    const closed = closeScreen(withPanel, id);
    expect(closed.screens).toEqual([]);
    expect(closed.assignment).toEqual({});
  });

  it('leaves other screens and their assignments untouched', () => {
    const opened1 = openScreen(EMPTY_SCREENS);
    const opened2 = openScreen(opened1.state);
    const withPanel = sendToScreen(opened2.state, 'panel-a', opened2.id, { w: 10, h: 9 });
    const closed = closeScreen(withPanel, opened1.id);
    expect(closed.screens.map((s) => s.id)).toEqual([opened2.id]);
    expect(closed.assignment).toEqual({ 'panel-a': opened2.id });
  });
});

describe('returnPanel', () => {
  it('removes a panel from its screen and unassigns it', () => {
    const { state, id } = openScreen(EMPTY_SCREENS);
    const withPanel = sendToScreen(state, 'panel-a', id, { w: 10, h: 9 });
    const returned = returnPanelFromScreen(withPanel, 'panel-a');
    expect(returned.assignment).toEqual({});
    expect(returned.screens.find((s) => s.id === id)?.layout).toEqual([]);
  });

  it('remembers a screen window position so it reopens where it was', () => {
    const { state } = openScreen(EMPTY_SCREENS);
    const bounds = { width: 900, height: 700, left: 10, top: 20 };
    expect(rememberScreenBounds(state, 2, bounds).screens[0].bounds).toEqual(bounds);
  });
});
