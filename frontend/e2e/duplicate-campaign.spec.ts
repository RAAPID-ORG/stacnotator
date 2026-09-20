/**
 * Duplicate campaign from the project campaigns list.
 *
 * Verifies:
 * - The row button opens the modal; both include switches are mandatory
 * - Copying tasks follows up on assignments, and on what agents hold
 * - Cross-option hint when annotations are copied without tasks
 * - The request carries the chosen options and success navigates to the
 *   new campaign's settings
 * - Copying into another project drops everything that names a user and
 *   lands in that project
 */
import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN, MOCK_PROJECT } from './fixtures/mock-data';

const DUPLICATED = { ...MOCK_CAMPAIGN, id: 43, name: 'Test Campaign (copy)' };

/** A second project the viewer administers, in the same organization. */
const OTHER_PROJECT = { ...MOCK_PROJECT, id: 9, name: 'Other Project', campaign_count: 0 };
const COPIED_OVER = { ...MOCK_CAMPAIGN, id: 44, project_id: OTHER_PROJECT.id };

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

  test('the assignment questions only come up once tasks are copied', async ({ appPage }) => {
    await openCampaignsList(appPage);
    await appPage.getByTestId('duplicate-campaign').click();

    await appPage.getByTestId('duplicate-tasks').getByRole('radio', { name: 'No' }).click();
    await expect(appPage.getByTestId('duplicate-assignments')).toBeHidden();

    await appPage.getByTestId('duplicate-tasks').getByRole('radio', { name: 'Yes' }).click();
    const agents = appPage.getByTestId('duplicate-agent-assignments');
    await expect(agents).toBeVisible();

    // What agents hold is a question about the assignments, so it goes with them.
    await appPage.getByTestId('duplicate-assignments').getByRole('radio', { name: 'No' }).click();
    await expect(agents).toBeHidden();
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
    await appPage
      .getByTestId('duplicate-agent-assignments')
      .getByRole('radio', { name: 'Yes' })
      .click();

    await Promise.all([
      appPage.waitForResponse(/\/api\/campaigns\/42\/duplicate$/),
      appPage.getByTestId('confirm-duplicate-campaign').click(),
    ]);

    expect(duplicateBody).toEqual({
      include_tasks: true,
      include_annotations: false,
      include_assignments: true,
      include_agent_assignments: true,
      include_user_layouts: true,
      target_project_id: MOCK_PROJECT.id,
    });
    await expect(appPage).toHaveURL(
      new RegExp(`/projects/${MOCK_PROJECT.id}/campaigns/${DUPLICATED.id}/settings$`)
    );
  });

  test('copying into another project keeps only the setup and the tasks', async ({ appPage }) => {
    let duplicateBody: unknown = null;
    await appPage.route(ROUTE.projects, async (route) => {
      await route.fulfill({ json: { items: [MOCK_PROJECT, OTHER_PROJECT] } });
    });
    await appPage.route(/\/api\/campaigns\/42\/duplicate$/, async (route) => {
      duplicateBody = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: COPIED_OVER });
    });
    await appPage.route(/\/api\/campaigns\/44$/, async (route) => {
      await route.fulfill({ json: COPIED_OVER });
    });

    await openCampaignsList(appPage);
    await appPage.getByTestId('duplicate-campaign').click();

    const target = appPage.getByTestId('duplicate-target-project');
    await expect(target.locator('option')).toHaveCount(2);
    await target.selectOption(String(OTHER_PROJECT.id));

    await expect(appPage.getByTestId('duplicate-annotations')).toBeHidden();
    await expect(appPage.getByTestId('duplicate-user-layouts')).toBeHidden();
    await expect(appPage.getByText('are not copied into another project')).toBeVisible();

    await appPage.getByTestId('duplicate-tasks').getByRole('radio', { name: 'Yes' }).click();
    await Promise.all([
      appPage.waitForResponse(/\/api\/campaigns\/42\/duplicate$/),
      appPage.getByTestId('confirm-duplicate-campaign').click(),
    ]);

    expect(duplicateBody).toEqual({
      include_tasks: true,
      include_annotations: false,
      include_assignments: false,
      include_agent_assignments: false,
      include_user_layouts: false,
      target_project_id: OTHER_PROJECT.id,
    });
    await expect(appPage).toHaveURL(
      new RegExp(`/projects/${OTHER_PROJECT.id}/campaigns/${COPIED_OVER.id}/settings$`)
    );
  });
});
