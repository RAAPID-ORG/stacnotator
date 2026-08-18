import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormField } from '../campaign/annotation';
import { apiSuccess, makeAnnotation, makeCampaign } from '~/features/annotation/testing/fixtures';
import { seedCampaign } from '../testing/seed';
import { MAX_PROBES, useWorkStore } from './work';

vi.mock('~/api/client', async (importActual) => {
  const actual = await importActual<typeof import('~/api/client')>();
  return { ...actual, createAnnotationOpenmode: vi.fn(), updateAnnotationOpenmode: vi.fn() };
});

import { createAnnotationOpenmode, updateAnnotationOpenmode } from '~/api/client';

const requiredField: FormField = { id: 1, title: 'Notes', type: 'text', required: true };
const optionalField: FormField = { id: 2, title: 'Remarks', type: 'text', required: false };
const geometry: GeoJSON.Geometry = { type: 'Point', coordinates: [1, 2] };
const savedAnnotation = makeAnnotation({ id: 999 });

/** The store reads the campaign's fields, so a test declares them by seeding
 *  the campaign the draft is being drawn on. */
function seedFields(fields: FormField[]): void {
  seedCampaign(
    makeCampaign({ id: 99, settings: { ...makeCampaign().settings, form_fields: fields } })
  );
}

beforeEach(() => {
  vi.mocked(createAnnotationOpenmode).mockReset();
  vi.mocked(updateAnnotationOpenmode).mockReset();
  vi.mocked(updateAnnotationOpenmode).mockResolvedValue(apiSuccess(savedAnnotation));
  seedFields([requiredField]);
  useWorkStore.setState({
    selectedLabelId: null,
    comment: '',
    confidence: null,
    flagged: false,
    flagComment: '',
    formValues: {},
    activeFieldIndex: null,
    draft: { phase: 'idle' } as const,
    selection: [],
    edit: null,
  });
});

describe('draft flow: begin -> drawEnd -> commit', () => {
  it('opens a draft when fields are required, then commits it exactly once even under a concurrent second call', async () => {
    useWorkStore.getState().beginDraft(1);
    expect(useWorkStore.getState().draft).toEqual({ phase: 'sketching', labelId: 1 });

    const outcome = await useWorkStore.getState().drawEnd(geometry);
    expect(outcome).toBe('drafted');
    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 1,
      geometry,
      savedId: null,
    });
    expect(createAnnotationOpenmode).not.toHaveBeenCalled();

    vi.mocked(createAnnotationOpenmode).mockResolvedValue(apiSuccess(savedAnnotation));
    useWorkStore.getState().setFormValues({ '1': 'answered' });

    const [first, second] = await Promise.all([
      useWorkStore.getState().commitDraft(),
      useWorkStore.getState().commitDraft(),
    ]);

    expect(createAnnotationOpenmode).toHaveBeenCalledTimes(1);
    expect(createAnnotationOpenmode).toHaveBeenCalledWith({
      path: { campaign_id: 99 },
      body: expect.objectContaining({ label_id: 1, geometry_wkt: 'POINT (1 2)' }),
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(useWorkStore.getState().draft).toEqual({ phase: 'idle' });
  });

  // Open mode draws one shape after another with the same label; clearing the
  // answers on a save must not also disarm the tool.
  it('keeps the annotator settings after a successful commit, and clears the answers', async () => {
    vi.mocked(createAnnotationOpenmode).mockResolvedValue(apiSuccess(savedAnnotation));
    useWorkStore.getState().beginDraft(4);
    await useWorkStore.getState().drawEnd(geometry);
    useWorkStore.getState().setFormValues({ '1': 'noted' });
    useWorkStore.getState().setComment('same for every shape');
    useWorkStore.getState().setConfidence(3);

    expect(await useWorkStore.getState().commitDraft()).toBe(true);

    expect(useWorkStore.getState().selectedLabelId).toBe(4);
    expect(useWorkStore.getState().comment).toBe('same for every shape');
    expect(useWorkStore.getState().confidence).toBe(3);
    expect(useWorkStore.getState().formValues).toEqual({});
    expect(useWorkStore.getState().activeFieldIndex).toBeNull();
  });

  it('commitDraft is a no-op when there is no open draft', async () => {
    const ok = await useWorkStore.getState().commitDraft();
    expect(ok).toBe(false);
    expect(createAnnotationOpenmode).not.toHaveBeenCalled();
  });

  // The Save button and the x reach the same annotation; saving must not be
  // the way to store one with its required questions unanswered.
  it('commitDraft refuses an unanswered required field, leaving the draft open to retry', async () => {
    useWorkStore.getState().beginDraft(1);
    await useWorkStore.getState().drawEnd(geometry);

    const ok = await useWorkStore.getState().commitDraft();

    expect(ok).toBe(false);
    expect(createAnnotationOpenmode).not.toHaveBeenCalled();
    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 1,
      geometry,
      savedId: null,
    });

    vi.mocked(createAnnotationOpenmode).mockResolvedValue(apiSuccess(savedAnnotation));
    useWorkStore.getState().setFormValues({ '1': 'answered' });
    expect(await useWorkStore.getState().commitDraft()).toBe(true);
  });

  it('commitDraft reverts to the draft phase on a failed save, preserving the geometry for a retry', async () => {
    useWorkStore.getState().beginDraft(1);
    await useWorkStore.getState().drawEnd(geometry);
    useWorkStore.getState().setFormValues({ '1': 'answered' });
    vi.mocked(createAnnotationOpenmode).mockRejectedValue(new Error('network error'));

    const ok = await useWorkStore.getState().commitDraft();
    expect(ok).toBe(false);
    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 1,
      geometry,
      savedId: null,
    });

    // Retry succeeds once the network recovers.
    vi.mocked(createAnnotationOpenmode).mockResolvedValue(apiSuccess(savedAnnotation));
    const retried = await useWorkStore.getState().commitDraft();
    expect(retried).toBe(true);
    expect(useWorkStore.getState().draft).toEqual({ phase: 'idle' });
  });

  it('drawEnd with no custom fields persists immediately without ever entering the draft phase', async () => {
    seedFields([]);
    useWorkStore.getState().beginDraft(2);
    vi.mocked(createAnnotationOpenmode).mockResolvedValue(apiSuccess(savedAnnotation));

    const outcome = await useWorkStore.getState().drawEnd(geometry);
    expect(outcome).toBe('saved');
    expect(useWorkStore.getState().draft).toEqual({ phase: 'idle' });
    expect(createAnnotationOpenmode).toHaveBeenCalledTimes(1);
    expect(createAnnotationOpenmode).toHaveBeenCalledWith({
      path: { campaign_id: 99 },
      body: expect.objectContaining({ label_id: 2 }),
    });
  });

  it('drawEnd with no custom fields reverts to a retryable draft on a failed save, instead of dropping the shape', async () => {
    seedFields([]);
    useWorkStore.getState().beginDraft(2);
    vi.mocked(createAnnotationOpenmode).mockRejectedValueOnce(new Error('network error'));

    const outcome = await useWorkStore.getState().drawEnd(geometry);
    expect(outcome).toBe('save-failed');
    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 2,
      geometry,
      savedId: null,
    });
    expect(createAnnotationOpenmode).toHaveBeenCalledTimes(1);

    // The shape is not lost: a normal commitDraft retry can still save it.
    vi.mocked(createAnnotationOpenmode).mockResolvedValueOnce(apiSuccess(savedAnnotation));
    const retried = await useWorkStore.getState().commitDraft();
    expect(retried).toBe(true);
    expect(useWorkStore.getState().draft).toEqual({ phase: 'idle' });
  });

  // Nothing required is outstanding, so holding the shape back would only risk
  // losing it: it is stored as drawn and the answers follow as an update.
  it('drawEnd stores the shape immediately when every field is optional, keeping the questions open', async () => {
    seedFields([optionalField]);
    vi.mocked(createAnnotationOpenmode).mockResolvedValue(apiSuccess(savedAnnotation));
    useWorkStore.getState().beginDraft(3);

    const outcome = await useWorkStore.getState().drawEnd(geometry);

    expect(outcome).toBe('saved');
    expect(createAnnotationOpenmode).toHaveBeenCalledTimes(1);
    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 3,
      geometry,
      savedId: 999,
    });

    useWorkStore.getState().setFormValues({ '2': 'answered late' });
    expect(await useWorkStore.getState().commitDraft()).toBe(true);

    expect(updateAnnotationOpenmode).toHaveBeenCalledWith({
      path: { campaign_id: 99, annotation_id: 999 },
      body: expect.objectContaining({ label_id: 3, form_values: { '2': 'answered late' } }),
    });
    expect(createAnnotationOpenmode).toHaveBeenCalledTimes(1);
    expect(useWorkStore.getState().draft).toEqual({ phase: 'idle' });
    expect(useWorkStore.getState().formValues).toEqual({});
  });

  it('drawEnd leaves a retryable draft when the immediate save fails', async () => {
    seedFields([optionalField]);
    vi.mocked(createAnnotationOpenmode).mockRejectedValueOnce(new Error('network error'));
    useWorkStore.getState().beginDraft(3);

    const outcome = await useWorkStore.getState().drawEnd(geometry);

    expect(outcome).toBe('save-failed');
    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 3,
      geometry,
      savedId: null,
    });

    vi.mocked(createAnnotationOpenmode).mockResolvedValueOnce(apiSuccess(savedAnnotation));
    expect(await useWorkStore.getState().commitDraft()).toBe(true);
  });

  it('drawEnd is a no-op outside the sketching phase', async () => {
    const outcome = await useWorkStore.getState().drawEnd(geometry);
    expect(outcome).toBe('nothing');
    expect(createAnnotationOpenmode).not.toHaveBeenCalled();
  });
});

describe('editDraftGeometry', () => {
  it('updates an open draft geometry', async () => {
    useWorkStore.getState().beginDraft(1);
    await useWorkStore.getState().drawEnd(geometry);
    const moved: GeoJSON.Geometry = { type: 'Point', coordinates: [5, 6] };
    useWorkStore.getState().editDraftGeometry(moved);
    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 1,
      geometry: moved,
      savedId: null,
    });
  });

  it('is a no-op outside the draft phase', () => {
    useWorkStore.getState().editDraftGeometry(geometry);
    expect(useWorkStore.getState().draft).toEqual({ phase: 'idle' });
  });
});

describe('closeDraft', () => {
  it('discards an incomplete draft (required field unanswered)', async () => {
    useWorkStore.getState().beginDraft(1);
    await useWorkStore.getState().drawEnd(geometry);
    const outcome = await useWorkStore.getState().closeDraft();
    expect(outcome).toBe('discarded');
    expect(useWorkStore.getState().draft).toEqual({ phase: 'idle' });
    expect(createAnnotationOpenmode).not.toHaveBeenCalled();
  });

  it('saves a complete draft', async () => {
    useWorkStore.getState().beginDraft(1);
    await useWorkStore.getState().drawEnd(geometry);
    useWorkStore.getState().setFormValues({ '1': 'answered' });
    vi.mocked(createAnnotationOpenmode).mockResolvedValue(apiSuccess(savedAnnotation));

    const outcome = await useWorkStore.getState().closeDraft();
    expect(outcome).toBe('saved');
    expect(createAnnotationOpenmode).toHaveBeenCalledTimes(1);
    expect(useWorkStore.getState().draft).toEqual({ phase: 'idle' });
    expect(useWorkStore.getState().formValues).toEqual({});
  });

  it('reverts to the draft phase on a failed save, instead of discarding the annotation', async () => {
    useWorkStore.getState().beginDraft(1);
    await useWorkStore.getState().drawEnd(geometry);
    useWorkStore.getState().setFormValues({ '1': 'answered' });
    vi.mocked(createAnnotationOpenmode).mockRejectedValue(new Error('network error'));

    const outcome = await useWorkStore.getState().closeDraft();
    expect(outcome).toBe('save-failed');
    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 1,
      geometry,
      savedId: null,
    });
    expect(useWorkStore.getState().formValues).toEqual({ '1': 'answered' });

    // Nothing was lost: a normal commitDraft retry can still save it.
    vi.mocked(createAnnotationOpenmode).mockResolvedValueOnce(apiSuccess(savedAnnotation));
    const retried = await useWorkStore.getState().commitDraft();
    expect(retried).toBe(true);
  });

  it('is a no-op when there is nothing open', async () => {
    const outcome = await useWorkStore.getState().closeDraft();
    expect(outcome).toBe('nothing');
    expect(createAnnotationOpenmode).not.toHaveBeenCalled();
  });
});

describe('form setters', () => {
  it('setFlagged clears flagComment when turned off', () => {
    useWorkStore.getState().setFlagComment('why');
    useWorkStore.getState().setFlagged(true);
    expect(useWorkStore.getState().flagComment).toBe('why');
    useWorkStore.getState().setFlagged(false);
    expect(useWorkStore.getState().flagComment).toBe('');
  });

  it('setSelection carries the anchor its on-map controls hang from', () => {
    useWorkStore.getState().setSelection([1, 2, 3], [4, 5]);
    expect(useWorkStore.getState().selection).toEqual([1, 2, 3]);
    expect(useWorkStore.getState().selectionAnchor).toEqual([4, 5]);

    useWorkStore.getState().clearEdit();
    expect(useWorkStore.getState().selectionAnchor).toBeNull();
  });
});

describe('a commit that resolves after the user has moved on', () => {
  /** Deferred createAnnotationOpenmode: the test decides when the save
   *  returns, which is the window the next shape gets drawn in. */
  function deferSave() {
    let settle: () => void = () => {};
    const pending = new Promise<Awaited<ReturnType<typeof createAnnotationOpenmode<true>>>>(
      (resolve) => {
        settle = () => resolve(apiSuccess(savedAnnotation));
      }
    );
    vi.mocked(createAnnotationOpenmode).mockReturnValueOnce(pending);
    return () => settle();
  }

  it('leaves the draft drawn in the meantime alone, answers included', async () => {
    useWorkStore.getState().beginDraft(1);
    await useWorkStore.getState().drawEnd(geometry);
    useWorkStore.getState().setFormValues({ '1': 'first shape' });

    const settle = deferSave();
    const inFlight = useWorkStore.getState().commitDraft();

    // The user draws the next shape and answers it while the first save is out.
    const second: GeoJSON.Geometry = { type: 'Point', coordinates: [3, 4] };
    useWorkStore.getState().beginDraft(2);
    await useWorkStore.getState().drawEnd(second);
    useWorkStore.getState().setFormValues({ '1': 'second shape' });

    settle();
    expect(await inFlight).toBe(true);

    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 2,
      geometry: second,
      savedId: null,
    });
    expect(useWorkStore.getState().formValues).toEqual({ '1': 'second shape' });
  });
});

describe('probe points', () => {
  beforeEach(() => useWorkStore.setState({ probePoints: [] }));

  it('accumulates probes so several locations can be compared at once', () => {
    const work = useWorkStore.getState();
    work.addProbePoint([1, 2]);
    work.addProbePoint([3, 4]);
    expect(useWorkStore.getState().probePoints).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('drops the oldest past the cap rather than refusing the click', () => {
    for (let i = 0; i <= MAX_PROBES; i++) useWorkStore.getState().addProbePoint([i, 0]);
    const points = useWorkStore.getState().probePoints;
    expect(points).toHaveLength(MAX_PROBES);
    expect(points[0]).toEqual([1, 0]);
    expect(points.at(-1)).toEqual([MAX_PROBES, 0]);
  });

  it('removes one by index and clears the rest on request', () => {
    const work = useWorkStore.getState();
    work.addProbePoint([1, 2]);
    work.addProbePoint([3, 4]);
    work.addProbePoint([5, 6]);

    useWorkStore.getState().removeProbePoint(1);
    expect(useWorkStore.getState().probePoints).toEqual([
      [1, 2],
      [5, 6],
    ]);

    useWorkStore.getState().clearProbePoints();
    expect(useWorkStore.getState().probePoints).toEqual([]);
  });
});
