import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_PROJECT } from './fixtures/mock-data';

/**
 * The Leaflet admin maps draw their backdrop with maplibre, which resolves its
 * worker from its own module URL - something no bundler can follow, so the file
 * has to be bundled deliberately. Without it the style still loads and not one
 * tile is ever asked for: a blank map, and only in a built app.
 */
test('the campaign area map asks for backdrop tiles', async ({ appPage }) => {
  const tiles: string[] = [];
  await appPage.route('**/tiles.openfreemap.org/planet/**', (route) => {
    tiles.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: '' });
  });

  await appPage.goto(`/projects/${MOCK_PROJECT.id}/campaigns/new`);
  await appPage.getByRole('textbox').first().fill('Backdrop check');
  await appPage.getByRole('button', { name: 'Continue' }).click();

  await expect(appPage.locator('.leaflet-container')).toBeVisible();
  await expect.poll(() => tiles.length, { timeout: 20_000 }).toBeGreaterThan(0);
});
