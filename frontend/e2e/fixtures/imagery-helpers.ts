import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { TASK_LOCATIONS } from './mock-data';
import type { CapturedRequest } from './annotator-fixture';

export const COORD_TOLERANCE = 0.01;

/** True when `url`'s host is exactly the mock tile server. Matching the parsed
 *  hostname (rather than a substring) avoids false positives like
 *  `https://evil.com/tiles.example.com` and satisfies CodeQL's URL check. */
export function isTileHost(url: string): boolean {
  try {
    return new URL(url).hostname === 'tiles.example.com';
  } catch {
    return false;
  }
}

export async function getCrosshairPosition(page: Page): Promise<{ lat: number; lon: number }> {
  // Reads data-lat / data-lon set directly on the crosshair DOM element in WGS84.
  // No projection math required in test code.
  const result = await page.waitForFunction(() => {
    const el = document.querySelector('[data-lat][data-lon]');
    if (!el) return null;
    const lat = parseFloat(el.getAttribute('data-lat') ?? '');
    const lon = parseFloat(el.getAttribute('data-lon') ?? '');
    if (isNaN(lat) || isNaN(lon)) return null;
    return { lat, lon };
  }, undefined, { timeout: 5000 });
  const value = await result.jsonValue();
  if (!value) throw new Error('Crosshair position not available after timeout');
  return value as { lat: number; lon: number };
}

export function assertCoordsMatch(
  actual: { lat: number; lon: number },
  expected: { lat: number; lon: number },
  label: string,
): void {
  const dLat = Math.abs(actual.lat - expected.lat);
  const dLon = Math.abs(actual.lon - expected.lon);
  expect(
    dLat < COORD_TOLERANCE && dLon < COORD_TOLERANCE,
    `[${label}] Crosshair at (${actual.lat.toFixed(4)}, ${actual.lon.toFixed(4)}) ` +
      `but expected (${expected.lat}, ${expected.lon}) - ` +
      `dlat=${dLat.toFixed(5)}, dlon=${dLon.toFixed(5)}`,
  ).toBe(true);
}

export async function assertCrosshairAt(page: Page, taskId: number, label: string): Promise<void> {
  const expected = TASK_LOCATIONS[taskId];
  if (!expected) throw new Error(`No location for task ${taskId}`);
  const actual = await getCrosshairPosition(page);
  assertCoordsMatch(actual, expected, label);
}

export function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

export function extractTileCoords(
  requests: CapturedRequest[],
): Array<{ z: number; x: number; y: number }> {
  const pattern = /\/(\d+)\/(\d+)\/(\d+)\?/;
  const results: Array<{ z: number; x: number; y: number }> = [];
  for (const r of requests) {
    if (!isTileHost(r.url)) continue;
    const m = r.url.match(pattern);
    if (m) results.push({ z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) });
  }
  return results;
}

export async function assertMinimapCenterAt(page: Page, taskId: number, label: string): Promise<void> {
  const expected = TASK_LOCATIONS[taskId];
  if (!expected) throw new Error(`No location for task ${taskId}`);
  const result = await page.waitForFunction(
    ({ lat, lon, tol }) => {
      const el = document.querySelector('[data-tour="minimap"]');
      if (!el) return null;
      const actualLat = parseFloat(el.getAttribute('data-center-lat') ?? '');
      const actualLon = parseFloat(el.getAttribute('data-center-lon') ?? '');
      if (isNaN(actualLat) || isNaN(actualLon)) return null;
      if (Math.abs(actualLat - lat) > tol || Math.abs(actualLon - lon) > tol) return null;
      return { lat: actualLat, lon: actualLon };
    },
    { lat: expected.lat, lon: expected.lon, tol: 0.01 },
    { timeout: 5000 },
  );
  const value = await result.jsonValue();
  if (!value) {
    const actual = await page
      .locator('[data-tour="minimap"]')
      .evaluate((el) => ({
        lat: el.getAttribute('data-center-lat'),
        lon: el.getAttribute('data-center-lon'),
      }));
    throw new Error(
      `[${label}] Minimap center (${actual.lat}, ${actual.lon}) not within tolerance of task ${taskId} (${expected.lat}, ${expected.lon})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Open mode helpers
// ---------------------------------------------------------------------------

/** Read the live viewport centre the minimap card reports (open mode). */
export async function getMinimapCenter(page: Page): Promise<{ lat: number; lon: number }> {
  const el = page.locator('[data-tour="minimap"]');
  await el.waitFor({ state: 'attached', timeout: 5000 });
  const { lat, lon } = await el.evaluate((node) => ({
    lat: node.getAttribute('data-center-lat'),
    lon: node.getAttribute('data-center-lon'),
  }));
  return { lat: parseFloat(lat ?? ''), lon: parseFloat(lon ?? '') };
}

/** Wait until the minimap centre settles within tolerance of an expected coord. */
export async function waitForMinimapCenter(
  page: Page,
  expected: { lat: number; lon: number },
  label: string,
  tol = COORD_TOLERANCE,
): Promise<void> {
  await page
    .waitForFunction(
      ({ lat, lon, t }) => {
        const node = document.querySelector('[data-tour="minimap"]');
        if (!node) return false;
        const aLat = parseFloat(node.getAttribute('data-center-lat') ?? '');
        const aLon = parseFloat(node.getAttribute('data-center-lon') ?? '');
        if (isNaN(aLat) || isNaN(aLon)) return false;
        return Math.abs(aLat - lat) <= t && Math.abs(aLon - lon) <= t;
      },
      { lat: expected.lat, lon: expected.lon, t: tol },
      { timeout: 5000 },
    )
    .catch(async () => {
      const actual = await getMinimapCenter(page);
      throw new Error(
        `[${label}] minimap centre (${actual.lat}, ${actual.lon}) never reached (${expected.lat}, ${expected.lon})`,
      );
    });
}

const mainCanvas = (page: Page) => page.locator('[data-tour="main-map"] canvas').first();

/** Click the centre of the main map - in open mode this is the viewport centre. */
export async function clickMapCenter(page: Page): Promise<void> {
  await mainCanvas(page).click();
}

/** Click at an (dx, dy) pixel offset from the main map centre. */
export async function clickMapAt(page: Page, dx: number, dy: number): Promise<void> {
  const box = await mainCanvas(page).boundingBox();
  if (!box) throw new Error('main map canvas has no bounding box');
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** Draw a polygon/line: click each (dx, dy) offset, then double-click the last to finish. */
export async function drawPolygon(page: Page, points: Array<[number, number]>): Promise<void> {
  const box = await mainCanvas(page).boundingBox();
  if (!box) throw new Error('main map canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let i = 0; i < points.length - 1; i++) {
    await page.mouse.click(cx + points[i][0], cy + points[i][1]);
  }
  const [lx, ly] = points[points.length - 1];
  await page.mouse.dblclick(cx + lx, cy + ly);
}

/** Minimal WKT parser: returns the geometry type and the first coordinate. */
export function parseWkt(wkt: string): { type: string; lon: number; lat: number } {
  const type = (wkt.match(/^\s*([A-Z]+)/i)?.[1] ?? '').toUpperCase();
  const first = wkt.match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  return {
    type,
    lon: first ? parseFloat(first[1]) : NaN,
    lat: first ? parseFloat(first[2]) : NaN,
  };
}

export const waitForCreate = (page: Page) =>
  page.waitForResponse((r) => r.url().includes('/create-annotation') && r.request().method() === 'POST', { timeout: 8000 });
export const waitForUpdate = (page: Page) =>
  page.waitForResponse((r) => /\/annotations\/\d+\/update$/.test(new URL(r.url()).pathname) && r.request().method() === 'PUT', { timeout: 8000 });
export const waitForDelete = (page: Page) =>
  page.waitForResponse((r) => /\/annotations\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === 'DELETE', { timeout: 8000 });

export function assertTilesFetchedForTask(
  requests: CapturedRequest[],
  sinceIndex: number,
  taskId: number,
  label: string,
): void {
  const expected = TASK_LOCATIONS[taskId];
  if (!expected) throw new Error(`No location for task ${taskId}`);

  const tiles = extractTileCoords(requests.slice(sinceIndex));
  if (tiles.length === 0) return; // OL cache hit - crosshair check is sufficient

  const TILE_TOLERANCE = 2;
  const hasTileNearTask = tiles.some((t) => {
    const center = latLonToTile(expected.lat, expected.lon, t.z);
    return (
      Math.abs(t.x - center.x) <= TILE_TOLERANCE && Math.abs(t.y - center.y) <= TILE_TOLERANCE
    );
  });

  expect(
    hasTileNearTask,
    `[${label}] Tiles loaded but none near task ${taskId} ` +
      `(${expected.lat}, ${expected.lon}). ` +
      `Got: ${tiles.map((t) => `${t.z}/${t.x}/${t.y}`).join(', ')}`,
  ).toBe(true);
}
