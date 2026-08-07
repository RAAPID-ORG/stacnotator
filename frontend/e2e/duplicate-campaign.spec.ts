/**
 * Duplicate campaign from the project campaigns list.
 *
 * Verifies:
 * - The row button opens the modal; both include switches are mandatory
 * - Cross-option hint when annotations are copied without tasks
 * - The request carries the chosen options and success navigates to the
 *   new campaign's settings
 */
import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN, MOCK_PROJECT } from './fixtures/mock-data';

const DUPLICATED = { ...MOCK_CAMPAIGN, id: 43, name: 'Test Campaign (copy)' };

const openCampaignsList = async (page: import('@playwright/test').Page) => {
  await Promise.all([
    page.waitForResponse(ROUTE.projectCampaigns),
    page.goto(`/projects/${MOCK_PROJECT.id}`),
  ]);
};

test.describe('Duplicate campaign', () => {
  test('both options are mandatory before the duplicate can run', async ({ appPage }) => {
    await openCampaignsList(appPage);

    await appPage.getByTestId('duplicate-campaign').click();
    const confirm = appPage.getByTestId('confirm-duplicate-campaign');
    await expect(confirm).toBeDisabled();

    await appPage.getByTestId('duplicate-tasks').getByRole('radio', { name: 'Yes' }).click();
    await expect(confirm).toBeDisabled();

    await appPage.getByTestId('duplicate-annotations').getByRole('radio', { name: 'No' }).click();
    await expect(confirm).toBeEnabled();
  });

  test('annotations without tasks surfaces the open-mode-only hint', async ({ appPage }) => {
    await openCampaignsList(appPage);
    await appPage.getByTestId('duplicate-campaign').click();

    await appPage.getByTestId('duplicate-tasks').getByRole('radio', { name: 'No' }).click();
    await appPage.getByTestId('duplicate-annotations').getByRole('radio', { name: 'Yes' }).click();

    await expect(appPage.getByText('only annotations that are not linked to a task')).toBeVisible();
  });

  test('duplicating sends the chosen options and opens the copy settings', async ({ appPage }) => {
    let duplicateBody: unknown = null;
    await appPage.route(/\/api\/campaigns\/42\/duplicate$/, async (route) => {
      duplicateBody = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: DUPLICATED });
    });
    await appPage.route(/\/api\/campaigns\/43$/, async (route) => {
      await route.fulfill({ json: DUPLICATED });
    });

    await openCampaignsList(appPage);
    await appPage.getByTestId('duplicate-campaign').click();
    await appPage.getByTestId('duplicate-tasks').getByRole('radio', { name: 'Yes' }).click();
    await appPage.getByTestId('duplicate-annotations').getByRole('radio', { name: 'No' }).click();

    await Promise.all([
      appPage.waitForResponse(/\/api\/campaigns\/42\/duplicate$/),
      appPage.getByTestId('confirm-duplicate-campaign').click(),
    ]);

    expect(duplicateBody).toEqual({ include_tasks: true, include_annotations: false });
    await expect(appPage).toHaveURL(
      new RegExp(`/projects/${MOCK_PROJECT.id}/campaigns/${DUPLICATED.id}/settings$`)
    );
  });
});
