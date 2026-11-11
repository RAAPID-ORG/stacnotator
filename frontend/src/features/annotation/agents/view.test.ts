import { describe, expect, it } from 'vitest';
import { checkView, defaultViews, fitCellPx, shortDateRange } from './view';

const LIMITS = { max_edge_px: 1568, max_megapixels: 1.15 };
const covers = (n: number) => Array.from({ length: n }, (_, i) => ({ slice_id: i }));

it.each([5, 60, 1000])(
  'starts at the dataset zoom rather than fitting a %sm sample extent',
  (extent) => {
    const views = defaultViews({
      campaign_id: 9,
      name: 'Iowa',
      bbox: [-93.7, 41.9, -93.35, 42.15],
      sample_extent_meters: extent,
      guide_markdown: null,
      labels: [],
      form_fields: [],
      imagery: [
        {
          source_id: 1,
          name: 'Sentinel-2',
          on_demand: false,
          default_zoom: 15,
          max_native_zoom: null,
          visualizations: ['True Color'],
          collections: [
            {
              collection_id: 1,
              name: 'August',
              cover_slice_id: 1,
              slices: [
                {
                  slice_id: 1,
                  name: 'August',
                  start_date: '2024-08-01',
                  end_date: '2024-08-31',
                },
              ],
            },
          ],
        },
      ],
      basemaps: [],
      timeseries: [],
    });
    expect(views[0].zoom).toBe(15);
  }
);

it('rejects exploration centres outside the map instead of rendering another location', () => {
  for (const center of [
    { lat: NaN, lon: 0 },
    { lat: 90, lon: 0 },
    { lat: 0, lon: 181 },
  ]) {
    expect(() => checkView({ cells: [{ slice_id: 1 }], center })).toThrow(/center/);
    expect(() => checkView({ cells: [{ slice_id: 1, center }] })).toThrow(/center/);
  }
});

describe('fitCellPx', () => {
  it('keeps the asked size when the image fits', () => {
    expect(fitCellPx({ cells: covers(8), columns: 4, cell_px: 256 }, LIMITS)).toBe(256);
  });

  it('shrinks cells until neither the long edge nor the megapixels are exceeded', () => {
    const view = { cells: [...covers(16), { timeseries_ids: [1] }], columns: 4, cell_px: 320 };
    const cellPx = fitCellPx(view, LIMITS);
    expect(cellPx).toBeLessThan(320);
    const rows = 4;
    const chart = Math.max(180, Math.round(cellPx * 0.75));
    expect(4 * cellPx * (rows * cellPx + chart)).toBeLessThanOrEqual(1_150_000);
  });

  it('follows the limits it is given', () => {
    const view = { cells: covers(4), columns: 2, cell_px: 768 };
    expect(fitCellPx(view, { max_edge_px: 2048, max_megapixels: 4 })).toBe(768);
    expect(fitCellPx(view, { max_edge_px: 1000, max_megapixels: 4 })).toBe(496);
  });

  it('refuses a view that cannot fit even at the smallest cells', () => {
    expect(() => fitCellPx({ cells: covers(36), columns: 1 }, LIMITS)).toThrow(/fewer cells/);
  });
});

describe('shortDateRange', () => {
  it('names whole months, days and spans compactly', () => {
    expect(shortDateRange('2025-05-01', '2025-05-31')).toBe('May 2025');
    expect(shortDateRange('2024-02-01', '2024-02-29')).toBe('Feb 2024');
    expect(shortDateRange('2025-05-12', '2025-05-12')).toBe('12 May 2025');
    expect(shortDateRange('2025-05-03', '2025-05-10')).toBe('3-10 May 2025');
    expect(shortDateRange('2025-04-28', '2025-05-05')).toBe('28 Apr-5 May 2025');
    expect(shortDateRange('2024-12-20', '2025-01-10')).toBe('20 Dec 2024-10 Jan 2025');
  });
});
