import { describe, expect, it } from 'vitest';
import {
  edgeStrength,
  flood,
  floodBarrier,
  median,
  median5,
  regionAt,
  rgbaToLab,
  stopLevels,
  WALL,
} from './regionGrow';

/** An RGBA image from rows of characters, each mapped to a colour. */
function image(rows: string[], colours: Record<string, [number, number, number]>) {
  const width = rows[0].length;
  const height = rows.length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = (y * width + x) * 4;
      if (ch === ' ') return;
      rgba.set([...colours[ch], 255], i);
    })
  );
  return { rgba, width, height };
}

function grow(
  rows: string[],
  colours: Record<string, [number, number, number]>,
  at: [number, number]
) {
  const { rgba, width, height } = image(rows, colours);
  const lab = median(rgbaToLab(rgba, width, height), width, height);
  const edges = edgeStrength(lab, width, height);
  const seed = at[1] * width + at[0];
  const reached = flood(floodBarrier(edges, lab, width, height, seed), width, height, seed);
  const stops = stopLevels(reached, lab, { minArea: 4 });
  const mask = regionAt(reached, width, height, stops.levels[stops.preferred], seed);
  return { mask, width, reached };
}

const area = (mask: Uint8Array) => mask.reduce((sum, v) => sum + v, 0);

describe('median5', () => {
  it('agrees with sorting on every ordering', () => {
    const values = [3, 1, 4, 1.5, 9];
    const permute = (rest: number[], prefix: number[] = []): number[][] =>
      rest.length
        ? rest.flatMap((v, i) =>
            permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...prefix, v])
          )
        : [prefix];
    for (const p of permute(values)) {
      expect(median5(p[0], p[1], p[2], p[3], p[4])).toBe(3);
    }
  });
});

describe('region growing', () => {
  const FIELDS: Record<string, [number, number, number]> = {
    g: [60, 120, 40],
    b: [150, 120, 80],
    r: [230, 230, 220],
  };
  // Two fields of different crops either side of a one-pixel road.
  const rows = Array.from({ length: 24 }, () => 'g'.repeat(14) + 'r' + 'b'.repeat(14));

  it('fills the clicked field up to the road', () => {
    const { mask, width } = grow(rows, FIELDS, [5, 10]);
    expect(mask[10 * width + 5]).toBe(1);
    expect(mask[10 * width + 20]).toBe(0);
    expect(area(mask)).toBeGreaterThan(14 * 24 * 0.8);
  });

  it('does not cross a missing tile', () => {
    const gap = rows.map((row, y) => (y === 12 ? ' '.repeat(row.length) : row));
    const { mask, width } = grow(gap, FIELDS, [5, 5]);
    expect(mask[20 * width + 5]).toBe(0);
  });

  it('fills a farmhouse the flood skipped inside the field', () => {
    const field = Array.from({ length: 40 }, (_, y) =>
      y >= 18 && y <= 22 ? 'g'.repeat(18) + 'rrrrr' + 'g'.repeat(17) : 'g'.repeat(40)
    );
    const { mask, width } = grow(field, FIELDS, [3, 3]);
    expect(mask[20 * width + 20]).toBe(1);
  });

  it('leaves pixels far in colour from the click unreached', () => {
    const { reached, width } = grow(rows, FIELDS, [5, 10]);
    expect(reached[10 * width + 20]).toBe(WALL);
  });
});

describe('stop levels', () => {
  /** A flood map whose region is `areas[i]` pixels at level i * 2. */
  function reachedFor(areas: number[], total: number): { reached: Uint8Array; lab: Float32Array } {
    const reached = new Uint8Array(total).fill(WALL);
    let next = 0;
    areas.forEach((area, i) => {
      while (next < area) reached[next++] = i * 2;
    });
    // One colour inside the first plateau, another beyond it, so the spill
    // into the neighbour reads as new colour.
    const lab = new Float32Array(total * 3);
    for (let p = 0; p < total; p++) lab[p * 3] = p < areas[1] ? 50 : 70;
    return { reached, lab };
  }

  it('offers the level before the spill first, with smaller and larger steps around it', () => {
    const { reached, lab } = reachedFor([100, 1000, 1100, 1200, 5000, 6000], 20_000);
    const stops = stopLevels(reached, lab);
    const preferred = stops.levels[stops.preferred];
    expect(preferred).toBe(6);
    expect(stops.levels[0]).toBeLessThan(preferred);
    expect(stops.levels.at(-1)).toBeGreaterThan(preferred);
    expect(stops.levels).toEqual([...stops.levels].sort((a, b) => a - b));
  });

  it('never offers a region covering most of the window', () => {
    const { reached, lab } = reachedFor([100, 1000, 19_000], 20_000);
    const stops = stopLevels(reached, lab);
    expect(stops.levels.every((level) => level < 4)).toBe(true);
  });
});
