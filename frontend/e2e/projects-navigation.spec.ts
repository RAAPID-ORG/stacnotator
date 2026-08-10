import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import {
  MOCK_ORG,
  MOCK_PROJECT,
  MOCK_PROJECT_CAMPAIGNS,
  MOCK_PROJECT_LISTED,
  MOCK_PROJECT_ORG_PUBLIC,
} from './fixtures/mock-data';

const openProjects = async (page: import('@playwright/test').Page) => {
  await Promise.all([page.waitForResponse(ROUTE.projects), page.goto('/projects')]);
};

test.describe('Projects list', () => {
  test('a first run auto-activates the approved organization and defaults to my projects', async ({
    appPage,
  }) => {
    await openProjects(appPage);

    await expect(appPage.getByTestId('org-switcher')).toContainText(MOCK_ORG.name);
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

    await expect(appPage.getByTestId('org-switcher')).toContainText(MOCK_ORG.name);
    await appPage.getByTestId('org-switcher').click();
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

    // Inside a project the sidebar gains its wayfinding block; the viewer is a
    // project admin, so every tab entry is offered.
    const projectNav = appPage.getByTestId('sidebar-project-nav');
    await expect(projectNav).toBeVisible();
    await expect(projectNav).toContainText(MOCK_PROJECT.name);
    await expect(projectNav.getByRole('button', { name: 'Members' })).toBeVisible();

    await projectNav.getByRole('button', { name: 'Settings' }).click();
    await expect(appPage).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT.id}\\?tab=settings$`));
  });
});
