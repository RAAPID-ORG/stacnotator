import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import { MOCK_PROJECT } from './fixtures/mock-data';

/** Projects live inside an organization, so a viewer without one cannot create
 *  any - the entry points have to disappear rather than fail on submit, and the
 *  page must explain how to get an organization. */
test.describe('Creating a project without an organization', () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.route(ROUTE.organizations, async (route) => {
      await route.fulfill({ json: { items: [] } });
    });
  });

  test('the projects list gates creation behind an info panel', async ({ appPage }) => {
    await Promise.all([appPage.waitForResponse(ROUTE.organizations), appPage.goto('/projects')]);

    await expect(appPage.getByRole('button', { name: 'New project' })).toHaveCount(0);

    const panel = appPage.getByTestId('org-gating-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Ask an organization admin to add you');

    await panel.getByRole('button', { name: 'Request an organization' }).click();
    await expect(appPage).toHaveURL(/\/organizations\/new$/);
  });

  test('a viewer in no organization still lands on the project they were invited to', async ({
    appPage,
  }) => {
    await Promise.all([appPage.waitForResponse(ROUTE.organizations), appPage.goto('/projects')]);

    // An explicit membership is the only work they have, so it is what the
    // page opens on - the public list is a fallback for having nothing.
    await expect(appPage.getByTestId('project-filter-mine')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(appPage.getByTestId('project-row')).toHaveCount(1);
    await expect(appPage.getByTestId('project-row')).toContainText(MOCK_PROJECT.name);

    await appPage.getByTestId('project-filter-public').click();
    await expect(appPage.getByTestId('project-row')).toHaveCount(0);
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
    await expect(emptyState).toContainText('Ask an organization admin to add you');
    await expect(emptyState.getByRole('button', { name: 'New organization' })).toBeVisible();
    await expect(appPage.getByLabel('Name')).toHaveCount(0);
  });
});
