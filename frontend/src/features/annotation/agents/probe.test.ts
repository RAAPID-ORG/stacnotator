import View from 'ol/View';
import { fromLonLat, toLonLat } from 'ol/proj';
import { describe, expect, it } from 'vitest';
import { metersPerPixel } from './pack';
import { locateProbe, lonLatToPixel, offsetMeters, pixelToLonLat } from './probe';

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
    const probe = locateProbe(TASK, { view, image: 2, x: 400 + 300, y: 200 });
    expect(probe.from).toEqual({ image: 2, x: 700, y: 200, cell: 1 });
    expect(probe.cell).toEqual({ basemap_id: 2, zoom: 12 });
    const metersEast = 100 * metersPerPixel(TASK.lat, 12);
    expect(offsetMeters(TASK, probe.lon, probe.lat).east_m).toBeCloseTo(metersEast, -1);
    expect(offsetMeters(TASK, probe.lon, probe.lat).north_m).toBe(0);
  });

  it('puts the centre of a cell on the task', () => {
    const probe = locateProbe(TASK, { view, image: 1, x: 200, y: 200 });
    expect(probe.lon).toBeCloseTo(TASK.lon, 9);
    expect(probe.lat).toBeCloseTo(TASK.lat, 9);
  });

  it('refuses pixels on a chart or outside the image', () => {
    expect(() => locateProbe(TASK, { view, image: 1, x: 10, y: 450 })).toThrow(/time series/);
    expect(() => locateProbe(TASK, { view, image: 1, x: 900, y: 10 })).toThrow(/outside/);
  });
});
