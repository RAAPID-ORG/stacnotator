import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN } from './fixtures/mock-data';

test('cloud imagery lives under Custom (other) and returns there after browsing', async ({
  appPage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
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
  await page.route('**/api/cloud-imagery/collections/11', (route) =>
    route.fulfill({
      json: {
        id: 11,
        title: 'Drone flights',
        project_id: 7,
        status: 'ready',
        visualizations: [],
        item_assets: {
          data: {
            title: 'GeoTIFF',
            type: 'image/tiff',
            roles: ['data'],
            bands: [{ name: 'red' }, { name: 'green' }, { name: 'blue' }],
          },
        },
      },
    })
  );

  await page.goto('/projects/7/campaigns/42/settings?tab=imagery');
  await page.getByRole('button', { name: 'Create source', exact: true }).click();
  await expect(page.getByTestId('custom-catalogs')).toHaveCount(0);
  await page.getByRole('button', { name: /Custom \(other\)/ }).click();
  const cloudSection = page.getByTestId('custom-catalogs');
  await expect(cloudSection).toContainText('No - I have my own imagery in cloud storage');
  await expect(cloudSection.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  await expect(cloudSection.getByRole('link', { name: 'Manage', exact: true })).toHaveAttribute(
    'href',
    '/projects/7?tab=settings#imagery'
  );
  await cloudSection.getByRole('button', { name: /Drone flights/ }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cloudSection).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Yes - my imagery is in a STAC catalog/ })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /No - I have raw XYZ tile URLs/ })).toBeVisible();
  await cloudSection.getByRole('link', { name: 'Manage', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/7\?tab=settings#imagery$/);
  await expect(page.getByRole('heading', { name: 'Imagery catalogs', exact: true })).toBeInViewport(
    {
      ratio: 1,
    }
  );
});
