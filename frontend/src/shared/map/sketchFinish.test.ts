import { describe, expect, it } from 'vitest';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import { sketchIsFinishable } from './interactions';

/** How OpenLayers holds a polygon mid-sketch: the clicked corners, then the
 *  pointer's position, then the ring closed back onto the first corner. */
const sketchRing = (corners: number) =>
  new Polygon([
    [...Array.from({ length: corners }, (_, i) => [i, i] as [number, number]), [99, 99], [0, 0]],
  ]);

const sketchLine = (points: number) =>
  new LineString([
    ...Array.from({ length: points }, (_, i) => [i, i] as [number, number]),
    [99, 99],
  ]);

describe('sketchIsFinishable', () => {
  it('closes a polygon once it has three corners', () => {
    expect(sketchIsFinishable('Polygon', sketchRing(3))).toBe(true);
    expect(sketchIsFinishable('Polygon', sketchRing(6))).toBe(true);
  });

  it('refuses a polygon that would come out degenerate', () => {
    // finishDrawing() itself does not check, so Enter on two corners would
    // otherwise emit a polygon with no area.
    expect(sketchIsFinishable('Polygon', sketchRing(1))).toBe(false);
    expect(sketchIsFinishable('Polygon', sketchRing(2))).toBe(false);
  });

  it('closes a line once it has two points', () => {
    expect(sketchIsFinishable('LineString', sketchLine(2))).toBe(true);
    expect(sketchIsFinishable('LineString', sketchLine(1))).toBe(false);
  });

  it('has nothing to close for a point, or before drawing starts', () => {
    expect(sketchIsFinishable('Point', new Point([0, 0]))).toBe(false);
    expect(sketchIsFinishable('Polygon', undefined)).toBe(false);
    // A shape/geometry mismatch is a stale sketch, never something to commit.
    expect(sketchIsFinishable('Polygon', sketchLine(4))).toBe(false);
  });
});
