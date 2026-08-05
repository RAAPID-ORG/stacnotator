import { test, expect, ROUTE } from './fixtures/annotator-fixture';

/** Projects live inside an organization, so a viewer without one cannot create
 *  any - the entry points have to disappear rather than fail on submit. */
test.describe('Creating a project without an organization', () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.route(ROUTE.organizations, async (route) => {
      await route.fulfill({ json: { items: [] } });
    });
  });

  test('the projects list offers no way to create one', async ({ appPage }) => {
    await Promise.all([appPage.waitForResponse(ROUTE.organizations), appPage.goto('/projects')]);

    await expect(appPage.getByTestId('project-row').first()).toBeVisible();
    await expect(appPage.getByRole('button', { name: 'New project' })).toHaveCount(0);
  });

  test('the new-project page asks the viewer to join an organization', async ({ appPage }) => {
    await Promise.all([
      appPage.waitForResponse(ROUTE.organizations),
      appPage.goto('/projects/new'),
    ]);

    // Scoped to the empty state: the sidebar carries its own "New organization" link.
    const emptyState = appPage
      .locator('.surface-section')
      .filter({ hasText: 'No organization to create in' });

    await expect(emptyState).toBeVisible();
    await expect(emptyState.getByRole('button', { name: 'New organization' })).toBeVisible();
    await expect(appPage.getByLabel('Name')).toHaveCount(0);
  });
});
