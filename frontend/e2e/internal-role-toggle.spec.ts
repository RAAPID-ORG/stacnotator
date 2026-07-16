import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_USER } from './fixtures/mock-data';
import type { Page } from '@playwright/test';

/**
 * The internal role marks first-party staff, who may point imagery and custom
 * maps at managed-identity storage. It is orthogonal to the admin/visitor ladder
 * and toggled per user from Settings > User management. Admins hold it
 * implicitly, so their chip must be read-only. We observe via DOM
 * (data-user-internal) and network (waitForResponse), never store internals.
 */

const ADMIN_USER = { ...MOCK_USER, is_approved: true, is_admin: true, is_internal: true };

const STAFF = {
  id: 'aaaa1111-0000-0000-0000-000000000001',
  email: 'staff@example.com',
  display_name: 'Staff',
  is_approved: true,
  is_admin: false,
  is_visitor: false,
  is_internal: false,
  issuer: 'firebase',
  allowed_tilers: [],
};

async function loadUserManagement(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: ADMIN_USER }));
  await page.route('**/api/auth/grantable-tilers', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/users', (route) =>
    route.fulfill({ json: [{ ...ADMIN_USER, allowed_tilers: [] }, STAFF] })
  );

  const usersLoaded = page.waitForResponse('**/api/auth/users');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'User management' }).click();
  await usersLoaded;
}

const internalChip = (page: Page, email: string) =>
  page.locator('tr', { hasText: email }).locator('[data-user-internal]');

test.describe('internal role toggle', () => {
  test('admin grants and revokes internal on a standard user', async ({ annotationPage: page }) => {
    await loadUserManagement(page);

    await page.route('**/grant-internal', (route) =>
      route.fulfill({ json: { ...STAFF, is_internal: true } })
    );
    await page.route('**/revoke-internal', (route) => route.fulfill({ json: STAFF }));

    const chip = internalChip(page, STAFF.email);
    await expect(chip).toHaveAttribute('data-user-internal', 'no');

    const granted = page.waitForResponse('**/grant-internal');
    await chip.click();
    expect((await granted).request().url()).toContain(`/users/${STAFF.id}/grant-internal`);
    await expect(chip).toHaveAttribute('data-user-internal', 'yes');
    await expect(chip).toHaveText('✓ Internal');

    const revoked = page.waitForResponse('**/revoke-internal');
    await chip.click();
    expect((await revoked).request().url()).toContain(`/users/${STAFF.id}/revoke-internal`);
    await expect(chip).toHaveAttribute('data-user-internal', 'no');
    await expect(chip).toHaveText('+ Internal');
  });

  test('admins are internal implicitly and cannot be toggled', async ({ annotationPage: page }) => {
    await loadUserManagement(page);

    const chip = internalChip(page, ADMIN_USER.email);
    await expect(chip).toHaveAttribute('data-user-internal', 'implicit');
    await expect(chip).toHaveText('✓ Internal');
    expect(await chip.evaluate((el) => el.tagName)).toBe('SPAN');
  });
});
