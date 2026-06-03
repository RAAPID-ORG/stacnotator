import { test, expect, waitForNavIdle, type CapturedRequest } from './fixtures/annotator-fixture';
import { TASK_1, TASK_2, TASK_3 } from './fixtures/mock-data';
import { assertCrosshairAt, assertTilesFetchedForTask } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;

const controls = (page: Page) => page.locator('[data-tour="controls"]');

// forest / cropland / urban -> capitalised label-button text (see LABELS fixture).
const LABEL_NAME: Record<number, string> = { 1: 'Forest', 2: 'Cropland', 3: 'Urban' };

async function expectLabelSelected(page: Page, labelId: number): Promise<void> {
  const btn = controls(page).locator('button', { hasText: LABEL_NAME[labelId] });
  await expect(btn).toHaveClass(/bg-brand-50/);
  await expect(btn).toContainText('✓');
}

async function expectNoLabelSelected(page: Page): Promise<void> {
  await expect(controls(page).locator('button.bg-brand-50')).toHaveCount(0);
}

async function expectComment(page: Page, text: string): Promise<void> {
  await expect(page.locator('textarea[placeholder^="Add a comment"]')).toHaveValue(text);
}

async function expectConfidence(page: Page, n: number): Promise<void> {
  await expect(controls(page).getByText(`${n}/5`, { exact: true })).toBeVisible();
}

async function expectCurrentTask(page: Page, annotationNumber: number): Promise<void> {
  expect(await readGoToValue(page)).toBe(String(annotationNumber));
}

function lastAnnotate(requests: CapturedRequest[]): CapturedRequest | undefined {
  return [...requests].reverse().find(
    (r) => r.method === 'POST' && r.pathname.endsWith('/annotate'),
  );
}

async function readGoToValue(page: Page): Promise<string> {
  return page.locator('input[type="number"][title="Press Enter to go"]').inputValue();
}

async function enableDoneFilter(page: Page): Promise<void> {
  await page.locator('[data-tour="task-filter"] button').first().click();
  await page.locator('label', { hasText: 'Done' }).waitFor({ state: 'visible' });
  await page.locator('label', { hasText: 'Done' }).click();
  await page.locator('[data-tour="task-filter"] button').first().click();
  await waitForNavIdle(page);
}

async function goTo(page: Page, n: number): Promise<void> {
  const input = page.locator('input[type="number"][title="Press Enter to go"]');
  await input.fill(String(n));
  await input.press('Enter');
  await waitForNavIdle(page);
}

async function pressLabel(page: Page, n: number): Promise<void> {
  await page.keyboard.press(String(n));
}

async function setComment(page: Page, text: string): Promise<void> {
  const ta = page.locator('textarea[placeholder^="Add a comment"]');
  await ta.fill(text);
  // Blur so the keyboard handler's textarea-focus guard doesn't drop subsequent keypresses.
  await ta.blur();
}

async function setConfidence(page: Page, n: number): Promise<void> {
  await page.keyboard.press(`Shift+${n}`);
}

async function doSubmit(page: Page): Promise<void> {
  const btn = page.locator('button', { hasText: /^(Submit|Update|Remove Label)$/ }).first();
  await expect(btn).toBeEnabled({ timeout: 5000 });
  await page.keyboard.press('Enter');
  await waitForNavIdle(page);
}

async function activeWindowTitle(page: Page): Promise<string | null> {
  return page.locator('.active-window .card-header').getAttribute('title');
}

async function assertTimelineShowsCollection(page: Page, collectionName: string): Promise<void> {
  await expect(page.locator('[data-tour="timeline-sidebar"]')).toContainText(collectionName, {
    timeout: 3000,
  });
}

// ---------------------------------------------------------------------------
// Label always goes to the displayed task
// ---------------------------------------------------------------------------

test.describe('Label always goes to the displayed task', () => {
  test.beforeEach(async ({ api }) => {
    api.clear();
  });

  test('submit on initial load targets TASK_1', async ({ annotationPage, api }) => {
    const page = annotationPage;
    await assertCrosshairAt(page, TASK_1.id, 'initial crosshair');
    expect(await activeWindowTitle(page)).toContain('Sentinel-2');

    await pressLabel(page, 1);
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_1.id, 'initial tiles');
    const req = lastAnnotate(api.requests);
    expect(req).toBeDefined();
    expect(req!.pathParams.annotation_task_id).toBe(String(TASK_1.id));
    expect(req!.body.label_id).toBe(1);
  });

  test('navigate S then submit targets TASK_2', async ({ annotationPage, api }) => {
    const page = annotationPage;
    await page.keyboard.press('s');
    await waitForNavIdle(page);

    await assertCrosshairAt(page, TASK_2.id, 'after S');
    expect(await activeWindowTitle(page)).toContain('Sentinel-2');
    expect(await readGoToValue(page)).toBe(String(TASK_2.annotation_number));

    await pressLabel(page, 1);
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_2.id, 'after S tiles');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(String(TASK_2.id));
  });

  test('navigate W (wraps to TASK_2) then submit targets TASK_2', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await page.keyboard.press('w');
    await waitForNavIdle(page);

    await assertCrosshairAt(page, TASK_2.id, 'after W wrap');
    expect(await readGoToValue(page)).toBe(String(TASK_2.annotation_number));

    await pressLabel(page, 1);
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_2.id, 'after W tiles');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(String(TASK_2.id));
  });

  test('GoTo 2 then submit targets TASK_2', async ({ annotationPage, api }) => {
    const page = annotationPage;
    await goTo(page, TASK_2.annotation_number);

    await assertCrosshairAt(page, TASK_2.id, 'after GoTo 2');
    expect(await activeWindowTitle(page)).toContain('Sentinel-2');

    await pressLabel(page, 1);
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_2.id, 'GoTo 2 tiles');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(String(TASK_2.id));
  });

  test('S → W → S (ends at TASK_2) then submit targets TASK_2', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await page.keyboard.press('s');
    await waitForNavIdle(page);
    await page.keyboard.press('w');
    await waitForNavIdle(page);
    await page.keyboard.press('s');
    await waitForNavIdle(page);

    await assertCrosshairAt(page, TASK_2.id, 'after S-W-S');
    expect(await readGoToValue(page)).toBe(String(TASK_2.annotation_number));

    await pressLabel(page, 1);
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_2.id, 'S-W-S tiles');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(String(TASK_2.id));
  });

  test('rapid S-S-S only advances once, submit targets TASK_2', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await page.keyboard.press('s');
    await page.keyboard.press('s');
    await page.keyboard.press('s');
    await waitForNavIdle(page);

    expect(await readGoToValue(page)).toBe(String(TASK_2.annotation_number));
    await assertCrosshairAt(page, TASK_2.id, 'rapid S crosshair');

    await pressLabel(page, 1);
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_2.id, 'rapid S tiles');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(String(TASK_2.id));
  });

  test('GoTo annotated task, change label, submit targets that task', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await enableDoneFilter(page);
    await goTo(page, TASK_3.annotation_number);

    await assertCrosshairAt(page, TASK_3.id, 'GoTo TASK_3 crosshair');
    expect(await activeWindowTitle(page)).toContain('Sentinel-2');

    await pressLabel(page, 2);
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_3.id, 'TASK_3 tiles');
    const req = lastAnnotate(api.requests);
    expect(req!.pathParams.annotation_task_id).toBe(String(TASK_3.id));
    expect(req!.body.label_id).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Form state loads correctly per task
// ---------------------------------------------------------------------------

test.describe('Form state loads correctly per task', () => {
  test('initial load shows empty form at TASK_1', async ({ annotationPage }) => {
    const page = annotationPage;
    await expectNoLabelSelected(page);
    await expectComment(page, '');
    await expectConfidence(page, 5);
    await expectCurrentTask(page, TASK_1.annotation_number);
    await assertCrosshairAt(page, TASK_1.id, 'initial form');
  });

  test('navigating to annotated task pre-fills form', async ({ annotationPage }) => {
    const page = annotationPage;
    await enableDoneFilter(page);
    await goTo(page, TASK_3.annotation_number);

    // TASK_3 annotation: label_id=1, comment="Clearly forest", confidence=8
    await expectLabelSelected(page, 1);
    await expectComment(page, 'Clearly forest');
    await expectConfidence(page, 8);
    await expectCurrentTask(page, TASK_3.annotation_number);

    await assertCrosshairAt(page, TASK_3.id, 'pre-fill crosshair');
    await assertTimelineShowsCollection(page, 'Sentinel-2 L2A');
  });

  test('navigate away and back restores pre-fill', async ({ annotationPage }) => {
    const page = annotationPage;
    await enableDoneFilter(page);
    await goTo(page, TASK_3.annotation_number);

    await page.keyboard.press('s');
    await waitForNavIdle(page);
    await goTo(page, TASK_3.annotation_number);

    await expectLabelSelected(page, 1);
    await expectComment(page, 'Clearly forest');
    await expectConfidence(page, 8);
    await assertCrosshairAt(page, TASK_3.id, 'restored pre-fill crosshair');
  });

  test('navigating from annotated to unannotated task clears form', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await enableDoneFilter(page);
    await goTo(page, TASK_3.annotation_number);
    await expectLabelSelected(page, 1);

    await goTo(page, TASK_1.annotation_number);

    await expectNoLabelSelected(page);
    await expectComment(page, '');
    await expectConfidence(page, 5);
    await expectCurrentTask(page, TASK_1.annotation_number);

    await assertCrosshairAt(page, TASK_1.id, 'cleared form crosshair');
    await assertTimelineShowsCollection(page, 'Sentinel-2 L2A');
  });

  test('unsaved label is discarded when navigating away', async ({ annotationPage }) => {
    const page = annotationPage;

    await pressLabel(page, 1);
    await expectLabelSelected(page, 1);

    await page.keyboard.press('s');
    await waitForNavIdle(page);

    await expectNoLabelSelected(page);
    await expectCurrentTask(page, TASK_2.annotation_number);
    await assertCrosshairAt(page, TASK_2.id, 'discarded label crosshair');
  });
});

// ---------------------------------------------------------------------------
// Submission body reflects exactly what the user set after navigation
// ---------------------------------------------------------------------------

test.describe('Submission body reflects what the user set after navigation', () => {
  test.beforeEach(async ({ api }) => {
    api.clear();
  });

  test('S then set comment + confidence + label - all three in POST body', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await page.keyboard.press('s');
    await waitForNavIdle(page);

    await assertCrosshairAt(page, TASK_2.id, 'pre-submit crosshair');

    await setComment(page, 'nav comment');
    await setConfidence(page, 2);
    await pressLabel(page, 3);
    await doSubmit(page);

    const req = lastAnnotate(api.requests);
    expect(req).toBeDefined();
    expect(req!.pathParams.annotation_task_id).toBe(String(TASK_2.id));
    expect(req!.body.label_id).toBe(3);
    expect(req!.body.comment).toBe('nav comment');
    expect(req!.body.confidence).toBe(2);
  });

  test('GoTo 2 then set all three - all three in POST body', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await goTo(page, TASK_2.annotation_number);

    await assertCrosshairAt(page, TASK_2.id, 'pre-submit crosshair');

    await setComment(page, 'goto comment');
    await setConfidence(page, 1);
    await pressLabel(page, 2);
    await doSubmit(page);

    const req = lastAnnotate(api.requests);
    expect(req!.pathParams.annotation_task_id).toBe(String(TASK_2.id));
    expect(req!.body.label_id).toBe(2);
    expect(req!.body.comment).toBe('goto comment');
    expect(req!.body.confidence).toBe(1);
  });

  test('confidence decreased via Q key reaches body', async ({ annotationPage, api }) => {
    const page = annotationPage;
    await page.keyboard.press('q');
    await page.keyboard.press('q');
    await pressLabel(page, 1);
    await doSubmit(page);

    expect(lastAnnotate(api.requests)!.body.confidence).toBe(3);
  });

  test('confidence increased via E key after Q reaches body', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await page.keyboard.press('q');
    await page.keyboard.press('q');
    await page.keyboard.press('e');
    await pressLabel(page, 1);
    await doSubmit(page);

    expect(lastAnnotate(api.requests)!.body.confidence).toBe(4);
  });

  test('GoTo annotated task, override comment + label, correct body', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await enableDoneFilter(page);
    await goTo(page, TASK_3.annotation_number);

    await assertCrosshairAt(page, TASK_3.id, 'pre-submit crosshair');
    expect(await activeWindowTitle(page)).toContain('Sentinel-2');

    await setComment(page, 'override comment');
    await pressLabel(page, 2);
    await doSubmit(page);

    const req = lastAnnotate(api.requests);
    expect(req!.pathParams.annotation_task_id).toBe(String(TASK_3.id));
    expect(req!.body.comment).toBe('override comment');
    expect(req!.body.label_id).toBe(2);
  });

  test('no comment typed → comment is null in body', async ({ annotationPage, api }) => {
    const page = annotationPage;
    await pressLabel(page, 1);
    await doSubmit(page);

    expect(lastAnnotate(api.requests)!.body.comment).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Auto-advance delivers correct state for the next task
// ---------------------------------------------------------------------------

test.describe('Auto-advance: next task, correct imagery, clean form', () => {
  test.beforeEach(async ({ api }) => {
    api.clear();
  });

  test('submit TASK_1 → advances to TASK_2 with correct imagery', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await pressLabel(page, 1);
    await doSubmit(page);

    expect(await readGoToValue(page)).toBe(String(TASK_2.annotation_number));
    await assertCrosshairAt(page, TASK_2.id, 'auto-advance crosshair');
    assertTilesFetchedForTask(api.requests, 0, TASK_2.id, 'auto-advance tiles');
    expect(await activeWindowTitle(page)).toContain('Sentinel-2');
    await assertTimelineShowsCollection(page, 'Sentinel-2 L2A');
  });

  test('after auto-advance, next task form is empty', async ({ annotationPage, api }) => {
    const page = annotationPage;
    await pressLabel(page, 1);
    await doSubmit(page);

    await assertCrosshairAt(page, TASK_2.id, 'crosshair');
    await expectNoLabelSelected(page);
    await expectComment(page, '');
    await expectConfidence(page, 5);
    await expectCurrentTask(page, TASK_2.annotation_number);
  });

  test('comment from TASK_1 does NOT carry over to TASK_2', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await setComment(page, 'task1 comment');
    await pressLabel(page, 1);
    await doSubmit(page);

    await assertCrosshairAt(page, TASK_2.id, 'crosshair');
    await expectComment(page, '');
  });

  test('confidence from TASK_1 does NOT carry over to TASK_2', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await setConfidence(page, 1);
    await pressLabel(page, 1);
    await doSubmit(page);

    await assertCrosshairAt(page, TASK_2.id, 'crosshair');
    await expectConfidence(page, 5);
  });

  test('sequential submits on TASK_1 then TASK_2 both hit the right task_ids', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await assertCrosshairAt(page, TASK_1.id, 'before first submit');
    await pressLabel(page, 1);
    await doSubmit(page);

    await assertCrosshairAt(page, TASK_2.id, 'before second submit');
    await pressLabel(page, 2);
    await doSubmit(page);

    const posts = api.requests.filter(
      (r) => r.method === 'POST' && r.pathname.endsWith('/annotate'),
    );
    expect(posts).toHaveLength(2);
    expect(posts[0].pathParams.annotation_task_id).toBe(String(TASK_1.id));
    expect(posts[0].body.label_id).toBe(1);
    expect(posts[1].pathParams.annotation_task_id).toBe(String(TASK_2.id));
    expect(posts[1].body.label_id).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Real-world sequences
// ---------------------------------------------------------------------------

test.describe('Real-world sequences', () => {
  test.beforeEach(async ({ api }) => {
    api.clear();
  });

  test('back-and-forth navigation then submit - all assertions agree', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await page.keyboard.press('s');
    await waitForNavIdle(page);
    await page.keyboard.press('w');
    await waitForNavIdle(page);
    await page.keyboard.press('s');
    await waitForNavIdle(page);
    await page.keyboard.press('w');
    await waitForNavIdle(page);
    await page.keyboard.press('s');
    await waitForNavIdle(page);

    expect(await readGoToValue(page)).toBe(String(TASK_2.annotation_number));
    await assertCrosshairAt(page, TASK_2.id, 'crosshair');
    expect(await activeWindowTitle(page)).toContain('Sentinel-2');
    await assertTimelineShowsCollection(page, 'Sentinel-2 L2A');

    await pressLabel(page, 1);
    await setComment(page, 'final');
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_2.id, 'tiles');
    const req = lastAnnotate(api.requests);
    expect(req!.pathParams.annotation_task_id).toBe(String(TASK_2.id));
    expect(req!.body.comment).toBe('final');
  });

  test('comment set, navigate away without submitting, navigate back, change comment, submit', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await setComment(page, 'first');
    await page.keyboard.press('s');
    await waitForNavIdle(page);
    await page.keyboard.press('w');
    await waitForNavIdle(page);

    await expectComment(page, '');
    await expectCurrentTask(page, TASK_1.annotation_number);
    await assertCrosshairAt(page, TASK_1.id, 'crosshair');

    await setComment(page, 'second');
    await pressLabel(page, 1);
    await doSubmit(page);

    const req = lastAnnotate(api.requests);
    expect(req!.pathParams.annotation_task_id).toBe(String(TASK_1.id));
    expect(req!.body.comment).toBe('second');
  });

  test('GoTo annotated task, navigate away, navigate back, pre-fill intact, update and submit', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await enableDoneFilter(page);
    await goTo(page, TASK_3.annotation_number);

    await expectLabelSelected(page, 1);
    await expectComment(page, 'Clearly forest');
    await assertCrosshairAt(page, TASK_3.id, 'initial crosshair');
    await assertTimelineShowsCollection(page, 'Sentinel-2 L2A');

    await page.keyboard.press('s');
    await waitForNavIdle(page);
    await goTo(page, TASK_3.annotation_number);

    await expectLabelSelected(page, 1);
    await expectComment(page, 'Clearly forest');
    await expectConfidence(page, 8);
    await assertCrosshairAt(page, TASK_3.id, 'restored crosshair');

    await pressLabel(page, 2);
    await doSubmit(page);

    const req = lastAnnotate(api.requests);
    expect(req!.pathParams.annotation_task_id).toBe(String(TASK_3.id));
    expect(req!.body.label_id).toBe(2);
  });

  test('Enter immediately after S is dropped while isNavigating (debounce guard)', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await pressLabel(page, 1);
    await expectLabelSelected(page, 1);

    await page.keyboard.press('s');
    // 80ms: enough for React to re-render with isNavigating=true, within the 500ms debounce.
    await page.waitForTimeout(80);
    await page.keyboard.press('Enter');
    await waitForNavIdle(page);

    expect(await readGoToValue(page)).toBe(String(TASK_2.annotation_number));
    await assertCrosshairAt(page, TASK_2.id, 'crosshair after debounce');
    expect(lastAnnotate(api.requests)).toBeUndefined();
  });

  test('GoTo 2 then override with GoTo 1 - submit goes to TASK_1', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await goTo(page, TASK_2.annotation_number);
    await assertCrosshairAt(page, TASK_2.id, 'mid crosshair');

    await goTo(page, TASK_1.annotation_number);
    await assertCrosshairAt(page, TASK_1.id, 'final crosshair');
    expect(await readGoToValue(page)).toBe(String(TASK_1.annotation_number));

    await pressLabel(page, 1);
    await doSubmit(page);

    assertTilesFetchedForTask(api.requests, 0, TASK_1.id, 'tiles');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(String(TASK_1.id));
  });
});
