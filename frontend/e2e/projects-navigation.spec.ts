import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import { MOCK_PROJECT, MOCK_PROJECT_CAMPAIGNS, MOCK_PROJECT_LISTED } from './fixtures/mock-data';

const openProjects = async (page: import('@playwright/test').Page) => {
  await Promise.all([page.waitForResponse(ROUTE.projects), page.goto('/projects')]);
};

test.describe('Projects list', () => {
  test('the default filter shows only projects the viewer belongs to', async ({ appPage }) => {
    await openProjects(appPage);

    await expect(appPage.getByTestId('project-row')).toHaveCount(1);
    await expect(appPage.getByTestId('project-row')).toContainText(MOCK_PROJECT.name);
  });

  test('the "all" filter adds listed projects, which cannot be opened', async ({ appPage }) => {
    await openProjects(appPage);
    await appPage.getByTestId('project-filter-all').click();

    await expect(appPage.getByTestId('project-row')).toHaveCount(2);

    const listed = appPage.getByTestId('project-row').filter({ hasText: MOCK_PROJECT_LISTED.name });
    await expect(listed).toHaveAttribute('aria-disabled', 'true');
    await expect(listed).toContainText('Membership required to open');

    await listed.click();
    await expect(appPage).toHaveURL(/\/projects$/);
  });

  test('opening a project lands on its campaigns tab', async ({ appPage }) => {
    await openProjects(appPage);

    await Promise.all([
      appPage.waitForResponse(ROUTE.projectCampaigns),
      appPage.getByTestId('project-row').filter({ hasText: MOCK_PROJECT.name }).click(),
    ]);

    await expect(appPage).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT.id}$`));
    await expect(appPage.getByRole('heading', { name: MOCK_PROJECT.name })).toBeVisible();
    await expect(appPage.getByTestId('campaign-row')).toHaveCount(1);
    await expect(appPage.getByTestId('campaign-row')).toContainText(
      MOCK_PROJECT_CAMPAIGNS.items[0].name
    );
  });
});
