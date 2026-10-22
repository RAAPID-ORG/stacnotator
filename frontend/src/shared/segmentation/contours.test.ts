import { describe, expect, it } from 'vitest';
import { maskToPolygons, ringArea } from './contours';

function maskFrom(rows: string[]): { mask: Uint8Array; width: number; height: number } {
  const width = rows[0].length;
  const mask = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => (mask[y * width + x] = c === '#' ? 1 : 0)));
  return { mask, width, height: rows.length };
}

const trace = (rows: string[], opts = {}) => {
  const { mask, width, height } = maskFrom(rows);
  return maskToPolygons(mask, width, height, { minArea: 1, minHoleArea: 1, tolerance: 0, ...opts });
};

describe('maskToPolygons', () => {
  it('traces a block along its pixel corners, closed, exterior counter-clockwise once y is up', () => {
    const [polygon, ...rest] = trace(['....', '.##.', '.##.', '....']);
    expect(rest).toHaveLength(0);
    expect(polygon).toHaveLength(1);
    const ring = polygon[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(new Set(ring.map((p) => p.join(',')))).toEqual(new Set(['1,1', '3,1', '3,3', '1,3']));
    expect(ringArea(ring.slice(0, -1))).toBe(-4);
  });

  it('keeps a hole as an inner ring', () => {
    const [polygon] = trace(['#####', '#...#', '#...#', '#####']);
    expect(polygon).toHaveLength(2);
    expect(ringArea(polygon[1].slice(0, -1))).toBe(6);
  });

  it('fills holes below the minimum and drops specks', () => {
    const polygons = trace(['###...', '#.#...', '###..#'], { minArea: 2, minHoleArea: 2 });
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(1);
  });

  it('joins pixels that touch only at a corner into one simple ring', () => {
    const polygons = trace(['##..', '##..', '..##', '..##']);
    expect(polygons).toHaveLength(1);
    const ring = polygons[0][0].slice(0, -1);
    expect(new Set(ring.map((p) => p.join(','))).size).toBe(ring.length);
  });

  it('returns separate objects largest first', () => {
    const polygons = trace(['#...###', '....###']);
    expect(polygons.map((p) => Math.abs(ringArea(p[0].slice(0, -1))))).toEqual([6, 1]);
  });

  it('simplifies a staircase edge', () => {
    const rows = Array.from({ length: 40 }, (_, y) =>
      '#'.repeat(Math.floor(y / 2) + 1).padEnd(30, '.')
    );
    const exact = trace(rows)[0][0].length;
    const simplified = trace(rows, { tolerance: 1 })[0][0].length;
    expect(simplified).toBeLessThan(exact / 4);
  });
});
