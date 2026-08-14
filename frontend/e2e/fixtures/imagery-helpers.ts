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

/** Where the main map draws the crosshair, in WGS84. The map container carries
 *  it as data-crosshair-lat / data-crosshair-lon - the crosshair itself is an
 *  OpenLayers canvas feature and has no DOM node of its own. */
export const crosshairEl = (page: Page) =>
  page.locator('[data-panel-role="main-map"] [data-crosshair-lat][data-crosshair-lon]');

export async function getCrosshairPosition(page: Page): Promise<{ lat: number; lon: number }> {
  const el = crosshairEl(page);
  await el.waitFor({ state: 'attached', timeout: 5000 });
  const { lat, lon } = await el.evaluate((node) => ({
    lat: node.getAttribute('data-crosshair-lat'),
    lon: node.getAttribute('data-crosshair-lon'),
  }));
  const parsed = { lat: parseFloat(lat ?? ''), lon: parseFloat(lon ?? '') };
  if (isNaN(parsed.lat) || isNaN(parsed.lon)) throw new Error('Crosshair position not available');
  return parsed;
}

export function assertCoordsMatch(
  actual: { lat: number; lon: number },
  expected: { lat: number; lon: number },
  label: string
): void {
  const dLat = Math.abs(actual.lat - expected.lat);
  const dLon = Math.abs(actual.lon - expected.lon);
  expect(
    dLat < COORD_TOLERANCE && dLon < COORD_TOLERANCE,
    `[${label}] Crosshair at (${actual.lat.toFixed(4)}, ${actual.lon.toFixed(4)}) ` +
      `but expected (${expected.lat}, ${expected.lon}) - ` +
      `dlat=${dLat.toFixed(5)}, dlon=${dLon.toFixed(5)}`
  ).toBe(true);
}

export async function assertCrosshairAt(page: Page, taskId: number, label: string): Promise<void> {
  const expected = TASK_LOCATIONS[taskId];
  if (!expected) throw new Error(`No location for task ${taskId}`);
  let actual = await getCrosshairPosition(page);
  await expect
    .poll(
      async () => {
        actual = await getCrosshairPosition(page);
        return (
          Math.abs(actual.lat - expected.lat) < COORD_TOLERANCE &&
          Math.abs(actual.lon - expected.lon) < COORD_TOLERANCE
        );
      },
      { timeout: 5000 }
    )
    .toBe(true)
    .catch(() => {
      throw new Error(
        `[${label}] Crosshair at (${actual.lat.toFixed(4)}, ${actual.lon.toFixed(4)}) ` +
          `but expected (${expected.lat}, ${expected.lon})`
      );
    });
}

export function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

export function extractTileCoords(
  requests: CapturedRequest[]
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

export async function assertMinimapCenterAt(
  page: Page,
  taskId: number,
  label: string
): Promise<void> {
  const expected = TASK_LOCATIONS[taskId];
  if (!expected) throw new Error(`No location for task ${taskId}`);
  await waitForMinimapCenter(page, expected, label);
}

// ---------------------------------------------------------------------------
// Open mode helpers
// ---------------------------------------------------------------------------

/** Read the live viewport centre the minimap card reports. The card header
 *  renders it as "lat, lon" text - that rendered text is the observable. */
export async function getMinimapCenter(page: Page): Promise<{ lat: number; lon: number }> {
  const el = page.locator('[data-testid="viewport-center"]').first();
  await el.waitFor({ state: 'attached', timeout: 5000 });
  const [lat, lon] = (await el.textContent())?.split(',').map((part) => parseFloat(part)) ?? [];
  return { lat, lon };
}

/** Wait until the minimap centre settles within tolerance of an expected coord. */
export async function waitForMinimapCenter(
  page: Page,
  expected: { lat: number; lon: number },
  label: string,
  tol = COORD_TOLERANCE
): Promise<void> {
  let actual = { lat: NaN, lon: NaN };
  await expect
    .poll(
      async () => {
        actual = await getMinimapCenter(page);
        return (
          Math.abs(actual.lat - expected.lat) <= tol && Math.abs(actual.lon - expected.lon) <= tol
        );
      },
      { timeout: 5000 }
    )
    .toBe(true)
    .catch(() => {
      throw new Error(
        `[${label}] minimap centre (${actual.lat}, ${actual.lon}) never reached (${expected.lat}, ${expected.lon})`
      );
    });
}

// OpenLayers may create several transformed canvases whose individual boxes do
// not cover the whole map. Gestures belong to its full viewport, not whichever
// layer canvas happens to be first in the DOM.
const mainViewport = (page: Page) =>
  page.locator('[data-panel-role="main-map"] .ol-viewport').first();

/** Click the centre of the main map - in open mode this is the viewport centre. */
export async function clickMapCenter(page: Page): Promise<void> {
  await mainViewport(page).click();
}

/** Ctrl/Cmd+click the centre of the main map (edit-mode multi-select toggle).
 *  OL reads platformModifierKeyOnly: Ctrl on Linux/Windows (CI), Meta on macOS. */
export async function ctrlClickMapCenter(page: Page): Promise<void> {
  await mainViewport(page).click({ modifiers: ['ControlOrMeta'] });
}

/** Click at an (dx, dy) pixel offset from the main map centre. */
export async function clickMapAt(page: Page, dx: number, dy: number): Promise<void> {
  const viewport = mainViewport(page);
  const box = await viewport.boundingBox();
  if (!box) throw new Error('main map viewport has no bounding box');
  await viewport.click({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
}

/** Draw a polygon/line: click each (dx, dy) offset, then double-click the last to finish. */
export async function drawPolygon(page: Page, points: Array<[number, number]>): Promise<void> {
  const box = await mainViewport(page).boundingBox();
  if (!box) throw new Error('main map viewport has no bounding box');
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
  page.waitForResponse(
    (r) => r.url().includes('/create-annotation') && r.request().method() === 'POST',
    { timeout: 8000 }
  );
export const waitForUpdate = (page: Page) =>
  page.waitForResponse(
    (r) =>
      /\/annotations\/\d+\/update$/.test(new URL(r.url()).pathname) &&
      r.request().method() === 'PUT',
    { timeout: 8000 }
  );
export const waitForDelete = (page: Page) =>
  page.waitForResponse(
    (r) =>
      /\/annotations\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === 'DELETE',
    { timeout: 8000 }
  );
export const waitForBatchDelete = (page: Page) =>
  page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith('/annotations/batch-delete') &&
      r.request().method() === 'POST',
    { timeout: 8000 }
  );

/**
 * Fit all annotations into the viewport (Space) and wait for the view to settle
 * near the given centre. The default open-mode view is zoomed in tight, so this
 * is required before any whole-canvas box select is expected to reach them all.
 */
export async function fitAllAnnotations(
  page: Page,
  center: { lat: number; lon: number }
): Promise<void> {
  await page.keyboard.press(' ');
  await waitForMinimapCenter(page, center, 'fit all annotations', 0.3);
}

/**
 * Shift+drag a selection box across the whole main-map canvas (edit mode
 * box-select). Inset a few px so the drag stays inside the canvas bounds.
 */
export async function boxSelectWholeCanvas(page: Page): Promise<void> {
  const box = await mainViewport(page).boundingBox();
  if (!box) throw new Error('main map viewport has no bounding box');
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

export function assertTilesFetchedForTask(
  requests: CapturedRequest[],
  sinceIndex: number,
  taskId: number,
  label: string
): void {
  const expected = TASK_LOCATIONS[taskId];
  if (!expected) throw new Error(`No location for task ${taskId}`);

  // A viewport spans well over one tile, so "near" is a neighbourhood rather
  // than the centre tile: the centre itself is often cache-served while the
  // surrounding ring is fetched. Task fixtures sit >= 9 tiles apart at z14, so
  // this still tells the tasks apart.
  const TILE_TOLERANCE = 6;
  const near = (t: { z: number; x: number; y: number }, at: { lat: number; lon: number }) => {
    const center = latLonToTile(at.lat, at.lon, t.z);
    return Math.abs(t.x - center.x) <= TILE_TOLERANCE && Math.abs(t.y - center.y) <= TILE_TOLERANCE;
  };

  const tiles = extractTileCoords(requests.slice(sinceIndex));
  if (tiles.some((t) => near(t, expected))) return;

  // The preloader warms the tasks the user is about to reach. Those tiles say
  // nothing about the current task, so they must not defeat the cache-hit
  // escape hatch below - the crosshair check carries the assertion there.
  const others = Object.entries(TASK_LOCATIONS)
    .filter(([id]) => Number(id) !== taskId)
    .map(([, loc]) => loc);
  const unexplained = tiles.filter((t) => !others.some((loc) => near(t, loc)));
  if (unexplained.length === 0) return;

  expect(
    false,
    `[${label}] Tiles loaded but none near task ${taskId} ` +
      `(${expected.lat}, ${expected.lon}). ` +
      `Got: ${unexplained.map((t) => `${t.z}/${t.x}/${t.y}`).join(', ')}`
  ).toBe(true);
}
