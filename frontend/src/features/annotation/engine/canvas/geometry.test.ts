import { describe, expect, it } from 'vitest';
import { nextFreeSlot, resolveDropCell } from './geometry';
import type { LayoutItem } from './types';

describe('nextFreeSlot', () => {
  it('places the first item at the origin of an empty layout', () => {
    expect(nextFreeSlot([], 10, 9)).toEqual({ x: 0, y: 0 });
  });

  it('continues the bottom-most row while there is horizontal room', () => {
    const layout: LayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 20, h: 10 },
      { i: 'b', x: 20, y: 0, w: 10, h: 10 },
    ];
    expect(nextFreeSlot(layout, 10, 9)).toEqual({ x: 30, y: 0 });
  });

  it('starts a new row when the bottom row has no room left', () => {
    const layout: LayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 60, h: 10 }];
    expect(nextFreeSlot(layout, 10, 9)).toEqual({ x: 0, y: 10 });
  });

  it('ignores gaps left by earlier, non-bottom rows (fragmented layout)', () => {
    const layout: LayoutItem[] = [
      // gap at x 0..20 in row 0 - not reused, only the bottom row is extended
      { i: 'a', x: 20, y: 0, w: 40, h: 10 },
      { i: 'b', x: 0, y: 10, w: 10, h: 10 },
    ];
    expect(nextFreeSlot(layout, 10, 9)).toEqual({ x: 10, y: 10 });
  });
});

describe('resolveDropCell', () => {
  const canvasRect = { left: 0, top: 0, width: 1206 };

  it('reports free when the pointer cell has no obstacles', () => {
    const result = resolveDropCell({ x: 600, y: 200 }, canvasRect, 0, 10, 9, []);
    expect(result.free).toBe(true);
  });

  it('pushes the cell downward and reports not-free when the target is occupied', () => {
    // A single item occupying the whole width at y=0..9; dropping there must
    // resolve to a free cell further down and report free: false, since the
    // pointer's own cell collided.
    const layout: LayoutItem[] = [{ i: 'existing', x: 0, y: 0, w: 60, h: 9 }];
    const result = resolveDropCell({ x: 0, y: 0 }, canvasRect, 0, 10, 9, layout);
    expect(result.free).toBe(false);
    expect(result.y).toBeGreaterThanOrEqual(9);
  });

  it('accounts for scroll offset when converting pointer position to a grid cell', () => {
    const atTop = resolveDropCell({ x: 0, y: 0 }, canvasRect, 0, 10, 9, []);
    const scrolled = resolveDropCell({ x: 0, y: 0 }, canvasRect, 500, 10, 9, []);
    expect(scrolled.y).toBeGreaterThan(atTop.y);
  });

  it('clamps x within the grid so the footprint never overhangs the right edge', () => {
    const result = resolveDropCell({ x: 100000, y: 0 }, canvasRect, 0, 10, 9, []);
    expect(result.x).toBeLessThanOrEqual(60 - 10);
  });
});
