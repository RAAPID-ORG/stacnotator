import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_PROJECT } from './fixtures/mock-data';

test('the campaign area map asks for backdrop tiles', async ({ appPage }) => {
  const tiles: string[] = [];
  await appPage.route('**/tiles.openfreemap.org/planet/**', (route) => {
    tiles.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: '' });
  });

  await appPage.goto(`/projects/${MOCK_PROJECT.id}/campaigns/new`);
  await appPage.getByRole('textbox').first().fill('Backdrop check');
  await appPage.getByRole('button', { name: 'Continue' }).click();

  await expect(appPage.locator('.ol-viewport')).toBeVisible();
  await expect.poll(() => tiles.length, { timeout: 20_000 }).toBeGreaterThan(0);
});
