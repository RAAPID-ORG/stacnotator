import { describe, expect, it } from 'vitest';
import { containsPoint, translateBounds } from './ViewportRect';

describe('minimap viewport dragging', () => {
  it('starts only from inside the viewport rectangle', () => {
    const bounds: [number, number, number, number] = [10, 20, 30, 40];
    expect(containsPoint(bounds, [20, 30])).toBe(true);
    expect(containsPoint(bounds, [9, 30])).toBe(false);
    expect(containsPoint(bounds, [20, 41])).toBe(false);
  });

  it('previews a drag without changing the viewport size', () => {
    expect(translateBounds([10, 20, 30, 40], [2, -3])).toEqual([12, 17, 32, 37]);
  });
});
