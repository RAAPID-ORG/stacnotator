import View from 'ol/View';
import { fromLonLat, toLonLat } from 'ol/proj';
import { describe, expect, it } from 'vitest';
import { metersPerPixel } from './pack';
import { locateProbe, lonLatToPixel, offsetMeters, pixelToLonLat, probeView } from './probe';

const TASK = { task_id: 1, lat: 52.37, lon: 4.89, geometry_wkt: 'POINT(4.89 52.37)' };
const CENTER: [number, number] = [TASK.lon, TASK.lat];

describe('pixelToLonLat', () => {
  it('matches the extent OpenLayers draws a map of that size at', () => {
    const zoom = 14.5;
    const view = new View({ center: fromLonLat(CENTER), zoom });
    const [west, south, east, north] = view.calculateExtent([512, 384]);
    const [lon0, lat0] = pixelToLonLat(CENTER, zoom, 512, 384, 0, 0);
    const [lon1, lat1] = pixelToLonLat(CENTER, zoom, 512, 384, 512, 384);
    const [w, n] = toLonLat([west, north]);
    const [e, s] = toLonLat([east, south]);
    expect(lon0).toBeCloseTo(w, 9);
    expect(lat0).toBeCloseTo(n, 9);
    expect(lon1).toBeCloseTo(e, 9);
    expect(lat1).toBeCloseTo(s, 9);
  });

  it('maps a pixel back to where it came from', () => {
    const [lon, lat] = pixelToLonLat(CENTER, 16, 320, 320, 37, 291);
    const [x, y] = lonLatToPixel(CENTER, 16, 320, 320, [lon, lat]);
    expect(x).toBeCloseTo(37, 6);
    expect(y).toBeCloseTo(291, 6);
  });
});

describe('locateProbe', () => {
  const view = {
    cells: [{ slice_id: 1 }, { basemap_id: 2, zoom: 12 }, { timeseries_ids: [5] }],
    columns: 2,
    cell_px: 400,
    zoom: 16,
  };

  it('finds the cell under the pixel and uses that cell zoom', () => {
    const probe = locateProbe(TASK, { view, reply: 7, image: 2, x: 400 + 300, y: 200 });
    expect(probe.from).toEqual({ reply: 7, image: 2, x: 700, y: 200, cell: 1 });
    expect(probe.cell).toEqual({ basemap_id: 2, zoom: 12 });
    const metersEast = 100 * metersPerPixel(TASK.lat, 12);
    expect(offsetMeters(TASK, probe.lon, probe.lat).east_m).toBeCloseTo(metersEast, -1);
    expect(offsetMeters(TASK, probe.lon, probe.lat).north_m).toBe(0);
  });

  it('puts the centre of a cell on the task', () => {
    const probe = locateProbe(TASK, { view, reply: 7, image: 1, x: 200, y: 200 });
    expect(probe.lon).toBeCloseTo(TASK.lon, 9);
    expect(probe.lat).toBeCloseTo(TASK.lat, 9);
  });

  it('explores from a zoomed-out pick and probes the new viewport, not the task', () => {
    const overview = { cells: [{ slice_id: 1 }], zoom: 12, cell_px: 400, columns: 1 };
    const field = locateProbe(TASK, { view: overview, reply: 7, image: 1, x: 310, y: 120 });
    const closeup = { ...overview, center: { lat: field.lat, lon: field.lon }, zoom: 18 };
    const second = locateProbe(TASK, { view: closeup, reply: 8, image: 1, x: 210, y: 190 });
    const [lon, lat] = pixelToLonLat([field.lon, field.lat], 18, 400, 400, 210, 190);
    expect(second.lon).toBeCloseTo(lon, 9);
    expect(second.lat).toBeCloseTo(lat, 9);
    expect(second.cell?.center).toEqual(closeup.center);

    const probed = probeView([second], [5], {}, { max_edge_px: 1200, max_megapixels: 1 });
    expect(probed.cells[0].center).toEqual(closeup.center);
    const again = locateProbe(TASK, {
      view: probed,
      reply: 9,
      image: 1,
      x: probed.cell_px! / 2,
      y: probed.cell_px! / 2,
    });
    expect(again.lon).toBeCloseTo(field.lon, 9);
    expect(again.lat).toBeCloseTo(field.lat, 9);
  });

  it('uses a cell override when comparing two locations in one image', () => {
    const differentPlaces = {
      ...view,
      center: { lat: 51, lon: 3 },
      cells: [{ slice_id: 1 }, { slice_id: 1, center: { lat: TASK.lat, lon: TASK.lon } }],
    };
    const nearby = locateProbe(TASK, { view: differentPlaces, reply: 7, image: 1, x: 200, y: 200 });
    const task = locateProbe(TASK, { view: differentPlaces, reply: 7, image: 1, x: 600, y: 200 });
    expect(nearby.lon).toBeCloseTo(3, 9);
    expect(task.lon).toBeCloseTo(TASK.lon, 9);
  });

  it('refuses pixels on a chart or outside the image', () => {
    expect(() => locateProbe(TASK, { view, reply: 7, image: 1, x: 10, y: 450 })).toThrow(
      /time series/
    );
    expect(() => locateProbe(TASK, { view, reply: 7, image: 1, x: 900, y: 10 })).toThrow(/outside/);
  });
});

describe('probeView', () => {
  const view = { cells: [{ slice_id: 1, zoom: 14 }], columns: 1, cell_px: 800 };
  const limits = { max_edge_px: 1568, max_megapixels: 0.5 };

  it('redraws a picked map once, over the same ground, when it must shrink', () => {
    const picks = [
      locateProbe(TASK, { view, reply: 1, image: 1, x: 790, y: 10 }),
      locateProbe(TASK, { view, reply: 1, image: 1, x: 400, y: 600 }),
    ];
    const probed = probeView(picks, [5], { remove_cloudy: true }, limits);
    expect(probed.cells).toHaveLength(2);
    expect(probed.cells[1]).toEqual({ timeseries_ids: [5], remove_cloudy: true });
    const px = probed.cell_px!;
    const zoom = probed.cells[0].zoom!;
    expect(px).toBeLessThan(800);
    const [x, y] = lonLatToPixel(CENTER, zoom, px, px, [picks[0].lon, picks[0].lat]);
    expect(x / px).toBeCloseTo(790 / 800, 2);
    expect(y / px).toBeCloseTo(10 / 800, 2);
  });
});
