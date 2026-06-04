import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_USER } from './fixtures/mock-data';
import type { Page } from '@playwright/test';

/**
 * Visitors are approved users who cannot create new campaigns. The "New
 * campaign" entry points must be hidden and the /campaigns/new route must
 * redirect. We observe via DOM (button/text) and network (waitForResponse on
 * /api/auth/me) rather than any store internals, and never touch tile traffic.
 */

const VISITOR_USER = { ...MOCK_USER, is_approved: true, is_visitor: true, is_admin: false };

/** Re-mock /api/auth/me (LIFO precedence) then load the overview as that user. */
async function loadOverviewAs(page: Page, user: object): Promise<void> {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ json: user });
  });
  const mePromise = page.waitForResponse('**/api/auth/me');
  await page.goto('/campaigns');
  await mePromise;
}

test.describe('visitor campaign-creation gating', () => {
  test('visitor sees no New campaign button and is redirected from /campaigns/new', async ({
    annotationPage: page,
  }) => {
    await loadOverviewAs(page, VISITOR_USER);

    await expect(page.getByRole('button', { name: 'New campaign' })).toHaveCount(0);
    await expect(
      page.getByText("You'll see campaigns here once you're added to one.")
    ).toBeVisible();

    await page.goto('/campaigns/new');
    await expect(page).toHaveURL(/\/campaigns$/);
    await expect(page.getByText('New campaign', { exact: false })).toHaveCount(0);
  });

  test('standard approved user sees the New campaign button', async ({ annotationPage: page }) => {
    await loadOverviewAs(page, { ...MOCK_USER, is_visitor: false });

    await expect(page.getByRole('button', { name: 'New campaign' })).toBeVisible();
  });
});
