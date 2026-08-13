import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures/annotator-fixture';
import { TEST_USER_ID } from './fixtures/mock-data';

const extractScript = `
import json
from src.main import app
from src.database import SessionLocal
from src.campaigns.service import get_campaign_full
from src.campaigns.schemas import CampaignOutFull
from src.annotation.service import get_annotation_tasks_for_campaign
from src.annotation.schemas import AnnotationTaskOut

db = SessionLocal()
campaign = get_campaign_full(db, 113)
out = CampaignOutFull.from_orm(campaign).model_dump(mode='json')
tasks = [AnnotationTaskOut.model_validate(task).model_dump(mode='json') for task in get_annotation_tasks_for_campaign(db, campaign)]
print(json.dumps({'campaign': out, 'tasks': tasks}))
db.close()
`;

const RUN_BENCHMARK = process.env.RUN_CAMPAIGN_BENCHMARK === '1';
const real = RUN_BENCHMARK
  ? JSON.parse(
      execFileSync('docker', ['exec', 'backend-dev', 'python', '-c', extractScript], {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      })
    )
  : null;

test.skip(
  !RUN_BENCHMARK,
  'real campaign/network benchmark; run explicitly with RUN_CAMPAIGN_BENCHMARK=1'
);

const tasks = (real?.tasks ?? []).map((task: any) => ({
  ...task,
  task_status: 'pending',
  annotations: [],
  assignments: [
    {
      user_id: TEST_USER_ID,
      status: 'pending',
      user_email: 'test@example.com',
      user_display_name: 'Test User',
    },
  ],
}));

function pointOf(task: any): { lon: number; lat: number } {
  const numbers = task.geometry.geometry.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length < 2) throw new Error(`Task ${task.id} is not a point`);
  return { lon: numbers[0], lat: numbers[1] };
}

function tileAt(lon: number, lat: number, z = 15): { x: number; y: number } {
  const n = 2 ** z;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
  };
}

function mosaicId(url: string): string | null {
  return /\/mosaic\/([^/]+)\/tiles\//.exec(url)?.[1] ?? null;
}

function tileCoord(url: string): { z: number; x: number; y: number } | null {
  const match = /\/tiles\/WebMercatorQuad\/(\d+)\/(\d+)\/(\d+)/.exec(url);
  return match ? { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) } : null;
}

function tileKey(url: string): string | null {
  const marker = mosaicId(url);
  const coord = tileCoord(url);
  return marker && coord ? `${marker}:${coord.z}:${coord.x}:${coord.y}` : null;
}

async function waitForBenchmarkNavigation(page: import('@playwright/test').Page): Promise<void> {
  const input = page.locator('input[type="number"][title="Press Enter to go"]');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

const view = real?.campaign.imagery_views[0];
const visibleIds = new Set<number>(
  (view?.default_canvas_layout.layout_data ?? []).map((item: any) => Number(item.i))
);
const markerToCollection = new Map<string, number>();
for (const source of real?.campaign.imagery_sources ?? []) {
  const visualization = source.visualizations[0]?.name;
  for (const collection of source.collections) {
    if (!visibleIds.has(collection.id)) continue;
    const slice = collection.slices[collection.cover_slice_index ?? 0];
    const tile = slice?.tile_urls.find((entry: any) => entry.visualization_name === visualization);
    const marker = tile ? mosaicId(tile.tile_url) : null;
    if (marker) markerToCollection.set(marker, collection.id);
  }
}

test('campaign 113 cold random-task benchmark', async ({ annotationPage }) => {
  test.setTimeout(180_000);
  await annotationPage.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: any[]
    ) {
      const canvas = this.canvas;
      const panel = canvas.closest(
        '[data-window-collection-id], [data-panel-id], [data-tour="main-map"]'
      ) as HTMLElement | null;
      const key =
        panel?.dataset.tour === 'main-map'
          ? 'main'
          : (panel?.dataset.windowCollectionId ?? panel?.dataset.panelId ?? null);
      const image = args[0] as { currentSrc?: string; src?: string } | undefined;
      const url = image?.currentSrc ?? image?.src ?? '';
      const marker = /\/mosaic\/([^/]+)\/tiles\//.exec(url)?.[1];
      const coord = /\/tiles\/WebMercatorQuad\/(\d+)\/(\d+)\/(\d+)/.exec(url);
      const tile = marker && coord ? `${marker}:${coord[1]}:${coord[2]}:${coord[3]}` : null;
      const state = window as typeof window & {
        __BENCH_TARGET_TILES__?: Record<string, string>;
        __BENCH_TILE_DRAWS__?: Record<string, number>;
      };
      const expectedPanel = tile ? state.__BENCH_TARGET_TILES__?.[tile] : null;
      const draws = (state.__BENCH_TILE_DRAWS__ ??= {});
      if (key && expectedPanel && (key === expectedPanel || key === 'main') && draws[key] == null) {
        draws[key] = Date.now();
      }
      return (original as (...values: any[]) => void).apply(this, args);
    } as typeof CanvasRenderingContext2D.prototype.drawImage;
    (
      window as typeof window & { __BENCH_TILE_DRAWS__?: Record<string, number> }
    ).__BENCH_TILE_DRAWS__ = {};
  });
  // The generic fixture catch-all matches any URL whose path contains /api/;
  // MPC's real tile endpoint does, so explicitly let those requests reach the
  // network before installing the real campaign response.
  await annotationPage.route('https://planetarycomputer.microsoft.com/**', (route) =>
    route.continue()
  );
  const seenTiles = new Set<string>();
  annotationPage.on('request', (request) => {
    const key = tileKey(request.url());
    if (key) seenTiles.add(key);
  });
  await annotationPage.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: real.campaign });
  });
  await annotationPage.route('**/api/campaigns/*/annotation-tasks', async (route) => {
    await route.fulfill({ json: { campaign_id: 113, tasks } });
  });
  await annotationPage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await annotationPage.waitForSelector('[data-tour="controls"]', { timeout: 30_000 });
  await waitForBenchmarkNavigation(annotationPage);

  expect(markerToCollection.size).toBe(visibleIds.size);
  const requestedIds = (process.env.BENCH_TASK_IDS ?? '').split(',').filter(Boolean).map(Number);
  type Candidate = { task: any; index: number; tile: { x: number; y: number } };
  const candidates: Candidate[] = tasks
    .map(
      (task: any, index: number): Candidate => ({
        task,
        index,
        tile: tileAt(pointOf(task).lon, pointOf(task).lat),
      })
    )
    .slice(12)
    .sort(() => Math.random() - 0.5);
  const selected: typeof candidates = requestedIds.map((id) => {
    const candidate = candidates.find((entry) => entry.task.id === id);
    if (!candidate) throw new Error(`Unknown campaign 113 task id: ${id}`);
    return candidate;
  });
  if (requestedIds.length === 0) {
    for (const candidate of candidates) {
      const separated = selected.every(
        (picked) =>
          Math.abs(candidate.index - picked.index) > 4 &&
          (Math.abs(candidate.tile.x - picked.tile.x) > 10 ||
            Math.abs(candidate.tile.y - picked.tile.y) > 10)
      );
      if (separated) selected.push(candidate);
      if (selected.length === 5) break;
    }
  }
  expect(selected).toHaveLength(requestedIds.length || 5);

  for (const { task } of selected) {
    const point = pointOf(task);
    const expected = tileAt(point.lon, point.lat);
    const targetKeys = [...markerToCollection.keys()].map(
      (marker) => `${marker}:15:${expected.x}:${expected.y}`
    );
    const targetTiles = Object.fromEntries(
      [...markerToCollection].map(([marker, collection]) => [
        `${marker}:15:${expected.x}:${expected.y}`,
        String(collection),
      ])
    );
    expect(
      targetKeys.filter((key) => seenTiles.has(key)),
      `task ${task.id} was already preloaded`
    ).toEqual([]);
    const started = new Map<number, number>();
    const completed = new Map<number, number>();
    const targetCompleted = new Map<number, number>();
    const requestCounts = new Map<number, number>();

    const onRequest = (request: import('@playwright/test').Request) => {
      const marker = mosaicId(request.url());
      const collection = marker ? markerToCollection.get(marker) : undefined;
      const coord = tileCoord(request.url());
      if (
        collection == null ||
        !coord ||
        coord.z !== 15 ||
        Math.abs(coord.x - expected.x) > 2 ||
        Math.abs(coord.y - expected.y) > 2
      )
        return;
      if (!started.has(collection)) started.set(collection, Date.now());
      requestCounts.set(collection, (requestCounts.get(collection) ?? 0) + 1);
    };
    const onResponse = (response: import('@playwright/test').Response) => {
      const marker = mosaicId(response.url());
      const collection = marker ? markerToCollection.get(marker) : undefined;
      const coord = tileCoord(response.url());
      if (
        collection == null ||
        !coord ||
        coord.z !== 15 ||
        Math.abs(coord.x - expected.x) > 2 ||
        Math.abs(coord.y - expected.y) > 2
      )
        return;
      if (response.ok() && !completed.has(collection)) completed.set(collection, Date.now());
      if (
        response.ok() &&
        targetTiles[tileKey(response.url()) ?? ''] === String(collection) &&
        !targetCompleted.has(collection)
      ) {
        targetCompleted.set(collection, Date.now());
      }
    };
    annotationPage.on('request', onRequest);
    annotationPage.on('response', onResponse);

    const gotoInput = annotationPage.locator('input[type="number"][title="Press Enter to go"]');
    await gotoInput.fill(String(task.annotation_number));
    await annotationPage.evaluate((targets) => {
      const state = window as typeof window & {
        __BENCH_TARGET_TILES__?: Record<string, string>;
        __BENCH_TILE_DRAWS__?: Record<string, number>;
      };
      state.__BENCH_TARGET_TILES__ = targets;
      state.__BENCH_TILE_DRAWS__ = {};
    }, targetTiles);
    const navigationAt = Date.now();
    await gotoInput.press('Enter');
    await waitForBenchmarkNavigation(annotationPage);
    await expect.poll(() => completed.size, { timeout: 45_000 }).toBe(visibleIds.size);
    await expect.poll(() => targetCompleted.size, { timeout: 45_000 }).toBe(visibleIds.size);

    await expect
      .poll(
        () =>
          annotationPage.evaluate(
            (ids) => {
              const draws =
                (window as typeof window & { __BENCH_TILE_DRAWS__?: Record<string, number> })
                  .__BENCH_TILE_DRAWS__ ?? {};
              return ids.every((id) => Number(draws[String(id)] ?? 0) > 0) && draws.main > 0;
            },
            [...visibleIds]
          ),
        { timeout: 45_000 }
      )
      .toBe(true);
    const rendered = await annotationPage.evaluate(
      () =>
        (window as typeof window & { __BENCH_TILE_DRAWS__?: Record<string, number> })
          .__BENCH_TILE_DRAWS__ ?? {}
    );

    const firstStart = Math.min(...started.values()) - navigationAt;
    const lastStart = Math.max(...started.values()) - navigationAt;
    const firstComplete = Math.min(...completed.values()) - navigationAt;
    const lastComplete = Math.max(...completed.values()) - navigationAt;
    const lastRendered = Math.max(...Object.values(rendered));
    const responseToPresented = Math.max(
      ...[...visibleIds].map((id) => Number(rendered[String(id)]) - Number(targetCompleted.get(id)))
    );
    const renderedTotal = lastRendered - navigationAt;
    const totalRequests = [...requestCounts.values()].reduce((sum, count) => sum + count, 0);
    console.log(
      `BENCH113 task=${task.id} annotation=${task.annotation_number} panels=${visibleIds.size} ` +
        `start_first=${firstStart}ms start_all=${lastStart}ms ` +
        `response_first=${firstComplete}ms response_all=${lastComplete}ms ` +
        `paint_after_response=${responseToPresented}ms painted_all=${renderedTotal}ms ` +
        `requests=${totalRequests} max_per_panel=${Math.max(...requestCounts.values())} ` +
        `target=${renderedTotal < 2000 ? 'PASS' : 'MISS'}`
    );

    annotationPage.off('request', onRequest);
    annotationPage.off('response', onResponse);
  }
});
