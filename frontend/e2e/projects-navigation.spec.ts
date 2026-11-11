import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import {
  MOCK_ORG,
  MOCK_PROJECT,
  MOCK_PROJECT_CAMPAIGNS,
  MOCK_PROJECT_LISTED,
  MOCK_PROJECT_ORG_PUBLIC,
  MOCK_TASK_SETS,
  MOCK_TASK_LIST,
  MOCK_CAMPAIGN,
} from './fixtures/mock-data';

const openProjects = async (page: import('@playwright/test').Page) => {
  await Promise.all([page.waitForResponse(ROUTE.projects), page.goto('/projects')]);
};

const SECOND_ORG = { ...MOCK_ORG, id: MOCK_ORG.id + 1, name: 'Second Org' };

test.describe('Projects list', () => {
  test('task sets stay compact and sticky, with content-sized statistics', async ({ appPage }) => {
    await appPage.route(ROUTE.campaignSummary, (route) =>
      route.fulfill({ json: { ...MOCK_CAMPAIGN, viewer_is_admin: true } })
    );
    await appPage.route('**/api/campaigns/*/task-sets', (route) =>
      route.fulfill({
        json: Array.from({ length: 20 }, (_, i) => ({
          ...MOCK_TASK_SETS[0],
          id: i + 1,
          name: `Task set ${i + 1}`,
          num_tasks: i === 0 ? MOCK_TASK_LIST.tasks.length : 0,
        })),
      })
    );
    await appPage.route('**/api/campaigns/*/tasks', (route) =>
      route.fulfill({
        json: {
          ...MOCK_TASK_LIST,
          tasks: MOCK_TASK_LIST.tasks.map((task) => ({ ...task, task_set_id: 1 })),
        },
      })
    );
    await appPage.route('**/api/campaigns/*/tasks/density?*', (route) =>
      route.fulfill({ json: [] })
    );
    await appPage.route('**/api/campaigns/*/statistics*', (route) =>
      route.fulfill({
        json: {
          campaign_id: 42,
          campaign_name: 'Test Campaign',
          total_annotations: 10,
          tasks_with_multiple_annotations: 2,
          overall_label_distribution: { Maize: 6, Wheat: 4 },
          krippendorff_alpha: 0.8,
          annotators: [
            {
              user_id: 'a',
              user_email: 'a@example.test',
              user_display_name: 'Alex',
              total_annotations: 6,
              label_distribution: { Maize: 4, Wheat: 2 },
            },
            {
              user_id: 'b',
              user_email: 'b@example.test',
              user_display_name: 'Sam',
              total_annotations: 4,
              label_distribution: { Maize: 2, Wheat: 2 },
            },
          ],
          pairwise_agreements: [
            { annotator1_id: 'a', annotator2_id: 'b', agreement_percentage: 100, shared_tasks: 2 },
          ],
        },
      })
    );
    await appPage.goto('/projects/7/campaigns/42/tasks');
    const picker = appPage.getByRole('tablist', { name: 'Task sets', exact: true });
    await expect(picker.getByRole('tab')).toHaveCount(21);
    const scrollLeft = appPage.getByRole('button', { name: 'Scroll tabs left' });
    const scrollRight = appPage.getByRole('button', { name: 'Scroll tabs right' });
    await expect(scrollLeft).toBeDisabled();
    await expect(scrollRight).toBeEnabled();
    await scrollRight.click();
    await expect(scrollLeft).toBeEnabled();
    await expect(picker.getByRole('tab', { name: /^All tasks 5$/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await scrollLeft.click();
    await expect(scrollLeft).toBeDisabled();
    await expect(appPage.getByRole('button', { name: 'Add tasks', exact: true })).toBeDisabled();
    expect((await appPage.getByTestId('task-scope-bar').boundingBox())!.height).toBeLessThan(50);
    await picker.getByRole('tab', { name: /^Task set 1 5$/ }).click();
    await expect(appPage).toHaveURL(/taskSet=1/);
    await expect(appPage.getByRole('button', { name: 'Add tasks', exact: true })).toBeEnabled();
    const statistics = appPage.locator('section').filter({
      has: appPage.getByRole('heading', { name: 'Statistics', exact: true }),
    });
    await expect(statistics.getByText('Multi-annotated tasks')).toBeVisible();
    expect((await statistics.boundingBox())!.height).toBeLessThan(140);
    await appPage.getByRole('row').last().scrollIntoViewIfNeeded();
    const pickerBounds = (await picker.boundingBox())!;
    expect(pickerBounds.y).toBeGreaterThanOrEqual(0);
    expect(pickerBounds.y).toBeLessThan(100);
    await expect(picker.getByRole('tab', { name: /^Task set 1 5$/ })).toBeInViewport();
    await statistics.getByRole('button', { name: 'More statistics' }).click();
    await expect(
      statistics.getByRole('heading', { name: 'Pairwise agreement', exact: true })
    ).toBeVisible();
    const sectionWidth = (await statistics.boundingBox())!.width;
    for (const table of await statistics.getByRole('table').all()) {
      expect((await table.boundingBox())!.width).toBeLessThan(sectionWidth * 0.9);
    }
    const distribution = statistics
      .locator('div')
      .filter({
        has: appPage.getByRole('heading', { name: 'Label distribution', exact: true }),
      })
      .last();
    expect((await distribution.boundingBox())!.width).toBeLessThanOrEqual(650);

    await picker.getByRole('tab', { name: /^Task set 1 5$/ }).focus();
    await appPage.keyboard.press('End');
    await expect(appPage).toHaveURL(/taskSet=20/);
    await expect(picker.getByRole('tab', { name: /^Task set 20 0$/ })).toBeInViewport();
    await expect(scrollRight).toBeDisabled();
    await expect(scrollLeft).toBeEnabled();

    await appPage.route('**/api/campaigns/*/task-sets', (route) =>
      route.fulfill({ json: MOCK_TASK_SETS })
    );
    await appPage.reload();
    await expect(picker.getByRole('tab')).toHaveCount(2);
    await expect(scrollLeft).toHaveCount(0);
    await expect(scrollRight).toHaveCount(0);
  });

  test('keeps a placeholder instead of showing an empty campaign list while loading', async ({
    appPage,
  }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await appPage.route(ROUTE.projectCampaigns, async (route) => {
      await pending;
      await route.fulfill({ json: MOCK_PROJECT_CAMPAIGNS });
    });
    await appPage.goto('/projects/7');
    await expect(appPage.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();
    await expect(appPage.getByRole('status', { name: 'Loading' })).toBeVisible();
    await expect(appPage.getByText('No campaigns yet', { exact: true })).toHaveCount(0);
    release();
    await expect(appPage.getByTestId('campaign-row')).toHaveCount(1);
    await expect(appPage.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  });

  test('campaign overview waits for task sets before showing its content', async ({ appPage }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await appPage.route('**/api/campaigns/*/task-sets', async (route) => {
      await pending;
      await route.fulfill({ json: MOCK_TASK_SETS });
    });
    await appPage.route('**/api/campaigns/*/agents', (route) =>
      route.fulfill({ json: { agents: [] } })
    );
    await appPage.route('**/api/campaigns/*/annotations/facets', (route) =>
      route.fulfill({ json: { total: 0, labels: [], users: [] } })
    );
    await appPage.goto('/projects/7/campaigns/42');
    await expect(
      appPage.getByRole('heading', { name: 'Test Campaign', exact: true })
    ).toBeVisible();
    await expect(appPage.getByRole('status', { name: 'Loading' })).toBeVisible();
    await expect(appPage.getByRole('heading', { name: 'All tasks', exact: true })).toHaveCount(0);
    await expect(appPage.getByRole('heading', { name: 'Task sets', exact: true })).toHaveCount(0);
    release();
    await expect(appPage.getByRole('heading', { name: 'All tasks', exact: true })).toBeVisible();
    await expect(
      appPage.getByRole('heading', { name: MOCK_TASK_SETS[0].name, exact: true })
    ).toBeVisible();
  });

  test('switching organization leaves the current project for the new organization', async ({
    appPage,
  }) => {
    await appPage.route(ROUTE.organizations, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: { items: [MOCK_ORG, SECOND_ORG] } });
    });
    await openProjects(appPage);
    await appPage.getByTestId('project-row').first().click();
    await expect(appPage).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT.id}$`));

    await appPage.getByTestId('account-menu').click();
    await appPage.getByRole('menuitemradio', { name: SECOND_ORG.name }).click();

    // The project belonged to the organization just left, so the workspace
    // lands on the new one's projects rather than staying put.
    await expect(appPage).toHaveURL(/\/projects$/);
    await expect(appPage.getByTestId('account-menu')).toContainText(SECOND_ORG.name);
  });

  test('a first run auto-activates the approved organization and defaults to my projects', async ({
    appPage,
  }) => {
    await openProjects(appPage);

    await expect(appPage.getByTestId('account-menu')).toContainText(MOCK_ORG.name);
    await expect(appPage.getByTestId('project-filter-mine')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(appPage.getByTestId('project-row')).toHaveCount(1);
    await expect(appPage.getByTestId('project-row')).toContainText(MOCK_PROJECT.name);
  });

  test('choosing "No organization" switches the default to public and hides members-only projects', async ({
    appPage,
  }) => {
    await openProjects(appPage);

    await expect(appPage.getByTestId('account-menu')).toContainText(MOCK_ORG.name);
    await appPage.getByTestId('account-menu').click();
    await appPage.getByRole('menuitemradio', { name: 'No organization' }).click();

    await expect(appPage.getByTestId('project-filter-public')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(appPage.getByTestId('project-row')).toHaveCount(0);
  });

  test('the "organization" filter shows every org project and an org member opens an org-public row', async ({
    appPage,
  }) => {
    await appPage.route(/\/api\/projects\/9(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: MOCK_PROJECT_ORG_PUBLIC });
    });
    await appPage.route(/\/api\/projects\/9\/campaigns/, async (route) => {
      await route.fulfill({ json: { items: [] } });
    });

    await openProjects(appPage);
    await appPage.getByTestId('project-filter-organization').click();

    await expect(appPage.getByTestId('project-row')).toHaveCount(3);

    const orgPublic = appPage
      .getByTestId('project-row')
      .filter({ hasText: MOCK_PROJECT_ORG_PUBLIC.name });
    await expect(orgPublic).toContainText('Org access');

    await Promise.all([
      appPage.waitForResponse(/\/api\/projects\/9\/campaigns/),
      orgPublic.click(),
    ]);

    await expect(appPage).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT_ORG_PUBLIC.id}$`));
    await expect(
      appPage.getByRole('heading', { name: MOCK_PROJECT_ORG_PUBLIC.name })
    ).toBeVisible();
  });

  test('the "all" filter adds listed projects, which cannot be opened', async ({ appPage }) => {
    await openProjects(appPage);
    await appPage.getByTestId('project-filter-all').click();

    await expect(appPage.getByTestId('project-row')).toHaveCount(3);

    const listed = appPage.getByTestId('project-row').filter({ hasText: MOCK_PROJECT_LISTED.name });
    await expect(listed).toHaveAttribute('aria-disabled', 'true');
    await expect(listed).toContainText('Membership required to open');

    await listed.click();
    await expect(appPage).toHaveURL(/\/projects$/);
  });

  test('opening a project lands on its campaigns and lists its sections in the sidebar', async ({
    appPage,
  }) => {
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

    // The viewer is a project admin, so the sidebar offers every section.
    const sections = appPage.getByTestId('sidebar-project');
    await expect(sections.getByRole('link', { name: 'Members' })).toBeVisible();

    await sections.getByRole('link', { name: 'Project settings' }).click();
    await expect(appPage).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT.id}\\?tab=settings$`));
    await expect(sections.getByRole('link', { name: 'Project settings' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
