import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN } from './fixtures/mock-data';

test('cloud imagery lives under Custom (other) and returns there after browsing', async ({
  appPage: page,
}) => {
  await page.route(/\/api\/campaigns\/\d+(\/detailed)?(\?.*)?$/, (route) =>
    route.fulfill({ json: { ...MOCK_CAMPAIGN, viewer_is_admin: true } })
  );
  await page.route(/\/api\/campaigns\/\d+\/(custom-maps|vector-layers)(\?.*)?$/, (route) =>
    route.fulfill({ json: [] })
  );
  await page.route(/\/api\/cloud-imagery\/collections\?/, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 11,
            title: 'Drone flights',
            project_id: 7,
            tiler: 'hosted',
            container_url: 'https://acct.blob.core.windows.net/imagery',
            visualizations: [],
            item_count: 1,
          },
        ],
      },
    })
  );

  await page.goto('/projects/7/campaigns/42/settings?tab=imagery');
  await page.getByRole('button', { name: 'Create source', exact: true }).click();
  await expect(page.getByTestId('custom-catalogs')).toHaveCount(0);
  await page.getByRole('button', { name: /Custom \(other\)/ }).click();
  const cloudSection = page.getByTestId('custom-catalogs');
  await expect(cloudSection).toContainText('No - I have my own imagery in cloud storage');
  await expect(cloudSection.getByRole('link', { name: 'Manage catalogs' })).toHaveAttribute(
    'href',
    '/projects/7?tab=settings'
  );
  await cloudSection.getByRole('button', { name: /Drone flights/ }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cloudSection).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Yes - my imagery is in a STAC catalog/ })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /No - I have raw XYZ tile URLs/ })).toBeVisible();
});
