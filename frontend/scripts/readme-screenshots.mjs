// Captures the README screenshots from a running dev stack (local auth mode,
// `make dev-up`), so they show real imagery and real work.
//
//   PROJECT=3 CAMPAIGN=51 node scripts/readme-screenshots.mjs
//
// PROJECT and CAMPAIGN pick a campaign with tasks and imagery. Optional:
// EXPLORE_CAMPAIGN (a campaign with drawn shapes, defaults to CAMPAIGN),
// VISUALIZER (a published visualizer's slug), BASE_URL (default
// http://localhost:5173) and OUT (default ../docs/images).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const env = process.env;
if (!env.PROJECT || !env.CAMPAIGN) {
  console.error('Set PROJECT and CAMPAIGN to a campaign with tasks and imagery.');
  process.exit(1);
}
const base = env.BASE_URL ?? 'http://localhost:5173';
const out = resolve(env.OUT ?? '../docs/images');
const campaign = (id) => `/projects/${env.PROJECT}/campaigns/${id}`;
const explore = env.EXPLORE_CAMPAIGN ?? env.CAMPAIGN;

// Each shot waits for its page's own marker, then for the imagery tiles.
const shots = [
  [
    'annotate-tasks',
    `${campaign(env.CAMPAIGN)}/annotate?mode=tasks`,
    '[data-tour="toolbar"]',
    8000,
  ],
  ['annotate-explore', `${campaign(explore)}/annotate?mode=explore`, '[data-tour="toolbar"]', 8000],
  ['campaign-overview', campaign(env.CAMPAIGN), 'h1.page-title', 2500],
  ['annotations', `${campaign(env.CAMPAIGN)}/annotations`, 'h1.page-title', 2500],
  ['imagery-settings', `${campaign(env.CAMPAIGN)}/settings?tab=imagery`, 'h1.page-title', 2500],
  ...(env.VISUALIZER ? [['visualizer', `/v/${env.VISUALIZER}`, 'canvas', 8000]] : []),
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
for (const [name, path, ready, settle] of shots) {
  await page.goto(base + path);
  await page.waitForSelector(ready, { timeout: 30_000 });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
}
await browser.close();
