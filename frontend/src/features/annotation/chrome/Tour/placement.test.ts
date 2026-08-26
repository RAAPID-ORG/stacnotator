import { describe, expect, it } from 'vitest';
import { placeTooltip, type Box, type Size } from './placement';

const VIEWPORT: Size = { width: 1440, height: 900 };
const TOOLTIP: Size = { width: 380, height: 200 };

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
});

const tooltipAt = (position: { left: number; top: number }): Box => ({
  ...position,
  ...TOOLTIP,
});

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

describe('placeTooltip', () => {
  it('honours the preferred side when it is clear', () => {
    const anchor = box(500, 100, 200, 40);
    const position = placeTooltip(anchor, TOOLTIP, [anchor], VIEWPORT, 'bottom');
    expect(position.top).toBe(156);
  });

  it('moves off the preferred side when something is in the way', () => {
    // A picker with the main map directly below it: "bottom" would land the
    // tooltip on the map, which is the thing the step is talking about.
    const picker = box(500, 60, 200, 40);
    const mainMap = box(300, 120, 800, 700);
    const position = placeTooltip(picker, TOOLTIP, [picker, mainMap], VIEWPORT, 'bottom');
    expect(overlaps(tooltipAt(position), picker)).toBe(false);
    expect(position.top).not.toBe(116);
  });

  it('keeps clear of controls the reader still has to reach', () => {
    // The resize practice lights the canvas but the reader must click Save in
    // the toolbar, so the toolbar is kept clear even though it is not lit.
    const canvas = box(0, 60, 1440, 780);
    const saveButton = box(1150, 8, 220, 40);
    const position = placeTooltip(canvas, TOOLTIP, [canvas, saveButton], VIEWPORT, 'top');
    expect(overlaps(tooltipAt(position), saveButton)).toBe(false);
  });

  it('never leaves the window, whichever side it settles on', () => {
    for (const anchor of [box(0, 0, 60, 40), box(1380, 860, 60, 40), box(700, 440, 40, 20)]) {
      const position = placeTooltip(anchor, TOOLTIP, [anchor], VIEWPORT, 'left');
      expect(position.left).toBeGreaterThanOrEqual(0);
      expect(position.top).toBeGreaterThanOrEqual(0);
      expect(position.left + TOOLTIP.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(position.top + TOOLTIP.height).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it('falls back to the least-covering spot when a lit panel fills the screen', () => {
    const wholeScreen = box(0, 0, 1440, 900);
    const position = placeTooltip(wholeScreen, TOOLTIP, [wholeScreen], VIEWPORT, 'bottom');
    expect(position.left).toBeGreaterThanOrEqual(0);
    expect(position.top + TOOLTIP.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('would rather clip a large panel than cover a small control', () => {
    // Both are unavoidable at this size; the picker is what the step is about.
    const picker = box(40, 400, 200, 44);
    const bigPanel = box(0, 60, 1440, 800);
    const position = placeTooltip(picker, TOOLTIP, [picker, bigPanel], VIEWPORT, 'right');
    expect(overlaps(tooltipAt(position), picker)).toBe(false);
  });

  it('prefers a corner over covering a second lit panel', () => {
    // Two panels lit side by side, leaving a free band at the bottom.
    const left = box(0, 60, 700, 500);
    const right = box(740, 60, 700, 500);
    const position = placeTooltip(left, TOOLTIP, [left, right], VIEWPORT, 'right');
    expect(overlaps(tooltipAt(position), right)).toBe(false);
    expect(overlaps(tooltipAt(position), left)).toBe(false);
  });

  it('centres itself when the step lights nothing', () => {
    const position = placeTooltip(null, TOOLTIP, [], VIEWPORT);
    expect(position).toEqual({ left: 530, top: 350 });
  });
});
