import { describe, expect, it } from 'vitest';
import { centerOfBounds, containsPoint, translateBounds } from './ViewportRect';

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

  // Averaging the latitudes would say 30; the rectangle's middle on a Mercator
  // map sits higher than that, and that is where the camera is pointed.
  it('centres a rectangle where it is drawn, not on its average latitude', () => {
    const [lon, lat] = centerOfBounds([10, 0, 30, 60]);
    expect(lon).toBeCloseTo(20, 6);
    expect(lat).toBeCloseTo(35.25, 1);
  });

  it('is the plain midpoint when the rectangle straddles the equator', () => {
    expect(centerOfBounds([-10, -20, 10, 20])[1]).toBeCloseTo(0, 6);
  });
});
