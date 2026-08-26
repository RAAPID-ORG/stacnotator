import { describe, expect, it } from 'vitest';
import { clampAnchorPosition } from './MapView';

const SIZE: [number, number] = [120, 32];
const VIEWPORT: [number, number] = [800, 600];
const OFFSET: [number, number] = [10, -5];

describe('clampAnchorPosition', () => {
  it('leaves controls where the geometry puts them when they fit', () => {
    expect(clampAnchorPosition([400, 300], OFFSET, SIZE, VIEWPORT)).toEqual({
      left: 410,
      top: 295,
    });
  });

  it('pulls controls back inside when the geometry sits at the right edge', () => {
    const { left } = clampAnchorPosition([795, 300], OFFSET, SIZE, VIEWPORT);
    expect(left + SIZE[0]).toBeLessThanOrEqual(VIEWPORT[0]);
  });

  it('keeps controls on screen for a geometry panned out of view', () => {
    expect(clampAnchorPosition([-500, -400], OFFSET, SIZE, VIEWPORT)).toEqual({
      left: 6,
      top: 6,
    });
    const farBelow = clampAnchorPosition([2000, 2000], OFFSET, SIZE, VIEWPORT);
    expect(farBelow.left + SIZE[0]).toBeLessThanOrEqual(VIEWPORT[0]);
    expect(farBelow.top + SIZE[1]).toBeLessThanOrEqual(VIEWPORT[1]);
  });

  it('prefers the top-left corner over hiding controls wider than the panel', () => {
    expect(clampAnchorPosition([400, 300], OFFSET, [900, 700], VIEWPORT)).toEqual({
      left: 6,
      top: 6,
    });
  });

  it('does not move anything before the panel has been measured', () => {
    expect(clampAnchorPosition([795, 300], OFFSET, SIZE, null)).toEqual({ left: 805, top: 295 });
    expect(clampAnchorPosition([795, 300], OFFSET, SIZE, [0, 0])).toEqual({ left: 805, top: 295 });
  });
});
