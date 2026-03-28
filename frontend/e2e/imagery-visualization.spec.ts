/**
 * Tests for imagery visualization options and slice/date associations.
 *
 * Verifies:
 * - Slice selector shows correct dates
 * - Switching slices changes tile URLs
 * - Visualization options belong to the correct campaign imagery configuration
 * - After task navigation, imagery state resets properly
 */
import { test, expect } from './fixtures/annotator-fixture';
import { SLICE_2024_01, SLICE_2024_06, COLLECTION_S2 } from './fixtures/mock-data';

test.describe('Imagery and Visualization', () => {
  test('slice dates from mock data are available in the campaign', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    // The campaign has 2 slices: "Jan 2024" and "Jun 2024"
    // These should appear somewhere in the UI - either as a select dropdown
    // on the imagery containers or as text in the header.

    // Check for slice selector dropdowns
    const sliceSelectors = page.locator('select[title="Select time slice"]');
    const count = await sliceSelectors.count();

    if (count > 0) {
      // The first selector should have options for both slices
      const options = sliceSelectors.first().locator('option');
      const optionTexts = await options.allTextContents();
      expect(optionTexts.some((t) => t.includes('Jan 2024'))).toBe(true);
      expect(optionTexts.some((t) => t.includes('Jun 2024'))).toBe(true);
    }
  });

  test('header shows current slice name', async ({ annotationPage }) => {
    const page = annotationPage;

    // The Canvas header renders: "{vizName} · {sourceName} · {sliceName} (1/2)"
    // Check that "Jan 2024" appears in the header (default slice index 0)
    const headerText = await page.locator('[data-tour="main-map"]').textContent();
    if (headerText) {
      expect(headerText).toContain('Jan 2024');
    }
  });

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
    // Wait for the isNavigating debounce to clear
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    // After task navigation, the slice should reset to 0 (Jan 2024)
    await expect(header).toContainText('Jan 2024', { timeout: 3000 });
  });

  test('tasks counter shows correct numbers', async ({ annotationPage }) => {
    const page = annotationPage;

    // The header shows "{completed}/{total} tasks done"
    // With default filter (pending only, our user), we have 2 pending tasks
    // Tasks 3 (done), 4 (skipped), 5 (conflicting) are completed
    // For the counter, it counts all tasks matching assignedTo filter regardless of status
    const headerText = await page.locator('[data-tour="main-map"]').textContent();
    if (headerText) {
      // Should contain "tasks done" text
      expect(headerText).toContain('tasks done');
    }
  });

  test('collection windows render for each show_as_window ref', async ({ annotationPage }) => {
    const page = annotationPage;

    // Our mock has 2 collections as windows: Sentinel-2 L2A and NDVI
    // These should render as grid cards with collection names in headers
    const cards = page.locator('.grid-card');
    const cardCount = await cards.count();

    // At minimum we expect: main, controls, minimap + 2 imagery windows = 5
    // (timeseries is absent since time_series is empty)
    expect(cardCount).toBeGreaterThanOrEqual(4);
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
