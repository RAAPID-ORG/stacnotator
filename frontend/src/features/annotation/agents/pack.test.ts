import { describe, expect, it } from 'vitest';
import { metersPerPixel, packView } from './pack';

describe('packView', () => {
  it('flows map cells into rows and gives a chart its own full row', () => {
    const packed = packView(
      [
        { slice_id: 1 },
        { slice_id: 2 },
        { slice_id: 3 },
        { timeseries_ids: [7] },
        { basemap_id: 4 },
      ],
      2,
      100
    );

    expect(packed.rects.map(({ x, y, width }) => [x, y, width])).toEqual([
      [0, 0, 100],
      [100, 0, 100],
      [0, 100, 100],
      [0, 200, 200],
      [0, 200 + packed.rects[3].height, 100],
    ]);
    expect(packed.width).toBe(200);
    expect(packed.height).toBe(200 + packed.rects[3].height + 100);
  });

  it('does not add an empty row after a full one', () => {
    expect(packView([{ slice_id: 1 }, { slice_id: 2 }], 2, 100).height).toBe(100);
  });
});

describe('metersPerPixel', () => {
  it('halves with every zoom level and shrinks away from the equator', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metersPerPixel(0, 15)).toBeCloseTo(metersPerPixel(0, 14) / 2);
    expect(metersPerPixel(60, 15)).toBeCloseTo(metersPerPixel(0, 15) / 2);
  });
});
