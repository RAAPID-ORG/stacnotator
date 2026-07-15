import { test, expect } from './fixtures/annotator-fixture';

test.describe('empty-slice no-data alert', () => {
  test('stale "no data" clears in explore once imagery exists elsewhere', async ({
    annotationPage,
  }) => {
    // All imagery tiles empty (204): the task-mode probe flags every slice
    // and raises the no-data state for the task location.
    await annotationPage.route('**/tiles.example.com/**', (route) =>
      route.fulfill({ status: 204 })
    );
    await annotationPage.goto('/campaigns/42/annotate?mode=tasks');
    await annotationPage.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
    await expect(annotationPage.getByText('No imagery', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Tiles serve data again - the fixture's 200 PNG route takes back over,
    // as if the user pans to a location that does have imagery.
    await annotationPage.unroute('**/tiles.example.com/**');

    await annotationPage
      .getByTestId('work-mode-switch')
      .getByRole('button', { name: 'Explore' })
      .click();
    await annotationPage.locator('body').click();
    for (let i = 0; i < 3; i++) {
      await annotationPage.keyboard.press('ArrowRight');
    }

    // Explore at the new location has imagery: no stale task-location alert.
    await expect(annotationPage.getByText('no data', { exact: true })).toHaveCount(0);
  });
});
