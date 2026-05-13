/**
 * Tests for imagery visualization options and slice/date associations.
 *
 * Verifies:
 * - Slice selector shows correct dates
 * - Switching slices changes tile URLs
 * - Visualization options belong to the correct campaign imagery configuration
 * - After task navigation, imagery state resets properly
 */
import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';

test.describe('Imagery and Visualization', () => {
  test('keyboard slice navigation (A/D) changes displayed slice name', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    const header = page.locator('[data-tour="main-map"]');

    // Press D to go to next slice
    await page.keyboard.press('d');
    // The header should now show "Jun 2024" (second slice)
    await expect(header).toContainText('Jun 2024', { timeout: 3000 });

    // Press A to go back
    await page.keyboard.press('a');
    await expect(header).toContainText('Jan 2024', { timeout: 3000 });
  });

  test('navigation resets slice index to 0', async ({ annotationPage }) => {
    const page = annotationPage;
    const header = page.locator('[data-tour="main-map"]');

    // Switch to slice 2 (Jun 2024)
    await page.keyboard.press('d');
    await expect(header).toContainText('Jun 2024', { timeout: 3000 });

    // Navigate to next task
    await page.keyboard.press('s');
    await waitForNavIdle(page);

    // After task navigation, the slice should reset to 0 (Jan 2024)
    await expect(header).toContainText('Jan 2024', { timeout: 3000 });
  });

  test('tasks counter reflects completed-vs-total in the assignment scope', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    // Header renders "<done> of <total> done" within data-tour="main-map".
    // Scope is the assignedTo filter (default: current user). Our user is
    // assigned to all 5 tasks, of which TASK_3/4/5 are done/skipped/conflicting
    // (all counted as completed). So the counter must show 3 of 5.
    const counter = page.locator('[data-tour="main-map"]').getByText(/\d+\s+of\s+\d+\s+done/i);
    await expect(counter).toContainText('3');
    await expect(counter).toContainText('5');
  });

  test('a grid card is rendered for each collection_ref with show_as_window=true', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    // Mock declares two windows (Sentinel-2 L2A and NDVI) plus three fixed
    // cards (main, controls, minimap). time_series is empty so no
    // timeseries card. Total must be exactly 5.
    const cards = page.locator('.grid-card');
    await expect(cards).toHaveCount(5);

    // One of the window cards must surface each declared collection name.
    // The names appear in multiple places (selectors, labels), so verify by
    // scoping to grid cards and matching at least one occurrence per name.
    await expect(cards.filter({ hasText: 'Sentinel-2 L2A' }).first()).toBeVisible();
    await expect(cards.filter({ hasText: 'NDVI' }).first()).toBeVisible();
  });

  test('keyboard Shift+I cycles visualization layer', async ({ annotationPage }) => {
    const page = annotationPage;
    const header = page.locator('[data-tour="main-map"]');

    // Initial layer should be "True Color" (first viz)
    await expect(header).toContainText('True Color');

    // Press Shift+I to cycle to next visualization within the current source
    await page.keyboard.press('Shift+i');
    await expect(header).toContainText('False Color', { timeout: 3000 });
  });
});
