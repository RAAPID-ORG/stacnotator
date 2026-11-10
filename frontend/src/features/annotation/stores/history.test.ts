import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replayAnnotationAction, type AnnotationActionOut } from '~/api/client';
import { client } from '~/api/client/client.gen';
import { handleError } from '~/shared/utils/errorHandler';
import { apiSuccess, makeAnnotation, makeCampaign } from '../testing/fixtures';
import { seedCampaign } from '../testing/seed';
import { useCampaignStore } from './campaign';
import { deltaWrites } from '../campaign/annotationDelta';
import { pageKeymap } from '../keymap';
import { useWorkStore } from './work';
import {
  historyAvailable,
  replayLabelling,
  trackLabellingHistory,
  useHistoryStore,
} from './history';

vi.mock('~/api/client', async (importActual) => ({
  ...(await importActual<typeof import('~/api/client')>()),
  replayAnnotationAction: vi.fn(),
}));
vi.mock('~/shared/utils/errorHandler', () => ({ handleError: vi.fn() }));

let stopTracking: (() => void) | undefined;
const fetchMock = vi.fn<typeof fetch>();
const write = () =>
  client.getConfig().fetch!(
    new Request('http://localhost/api/campaigns/7/annotations', { method: 'POST' })
  );
const saved = (id: string) => new Response('{}', { headers: { 'X-Annotation-Action': id } });

beforeEach(() => {
  vi.clearAllMocks();
  seedCampaign(makeCampaign());
  client.setConfig({ fetch: fetchMock });
  stopTracking = trackLabellingHistory(7);
});

afterEach(() => {
  stopTracking?.();
  client.setConfig({ fetch: undefined });
});

describe('labelling history', () => {
  it('records only successful actions, clears redo on new work, and resets between campaigns', async () => {
    fetchMock.mockResolvedValueOnce(saved('first'));
    await write();
    expect(fetchMock.mock.calls[0][0]).toBeInstanceOf(Request);
    expect(
      new Headers((fetchMock.mock.calls[0][0] as Request).headers).get('X-Annotation-History')
    ).toBe('true');
    expect(useHistoryStore.getState().undoStack).toEqual(['first']);
    useHistoryStore.setState({ redoStack: ['undone'] });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    await write();
    expect(useHistoryStore.getState().redoStack).toEqual(['undone']);
    fetchMock.mockResolvedValueOnce(saved('second'));
    await write();
    expect(useHistoryStore.getState().undoStack).toEqual(['first', 'second']);
    expect(useHistoryStore.getState().redoStack).toEqual([]);
    stopTracking!();
    stopTracking = trackLabellingHistory(8);
    expect(historyAvailable(true)).toBe(false);
  });

  it('blocks undo during writes and releases the guard after a network failure', async () => {
    useHistoryStore.setState({ undoStack: ['first'] });
    let reject!: (error: Error) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    const pending = write();
    expect(historyAvailable(true)).toBe(false);
    reject(new Error('Offline'));
    await expect(pending).rejects.toThrow('Offline');
    expect(historyAvailable(true)).toBe(true);
  });

  it('does not record or replay actions in task mode or bind undo/redo shortcuts there', async () => {
    useHistoryStore.setState({ undoStack: ['shape'] });
    useCampaignStore.setState({ workMode: 'tasks' });
    fetchMock.mockResolvedValueOnce(saved('task-mode-write'));
    await write();
    expect((fetchMock.mock.calls[0][0] as Request).headers.has('X-Annotation-History')).toBe(false);
    expect(useHistoryStore.getState().undoStack).toEqual(['shape']);
    expect(historyAvailable(true)).toBe(false);
    expect(pageKeymap().some((binding) => binding.key === 'ctrl+z')).toBe(false);
    await replayLabelling(true);
    expect(replayAnnotationAction).not.toHaveBeenCalled();
    useCampaignStore.setState({ workMode: 'explore' });
    expect(historyAvailable(true)).toBe(true);
    expect(pageKeymap().some((binding) => binding.key === 'ctrl+z')).toBe(true);
  });

  it('undoes and redoes a saved shape without changing the selected drawing label', async () => {
    useWorkStore.setState({ selectedLabelId: 2 });
    useHistoryStore.setState({ undoStack: ['shape'] });
    vi.mocked(replayAnnotationAction).mockResolvedValueOnce(
      apiSuccess({ annotations: [], deleted_ids: [99] })
    );
    await replayLabelling(true);
    expect(useWorkStore.getState().selectedLabelId).toBe(2);
    expect(useHistoryStore.getState().redoStack).toEqual(['shape']);
    const annotation = makeAnnotation({ id: 99, label_id: 1 });
    vi.mocked(replayAnnotationAction).mockResolvedValueOnce(
      apiSuccess({
        annotations: [annotation],
        deleted_ids: [],
      })
    );
    await replayLabelling(false);
    expect(deltaWrites(useWorkStore.getState().delta)).toContainEqual(
      expect.objectContaining({ id: 99, labelId: 1 })
    );
    expect(useWorkStore.getState().selectedLabelId).toBe(2);
    expect(useHistoryStore.getState().undoStack).toEqual(['shape']);
    expect(useHistoryStore.getState().redoStack).toEqual([]);
  });

  it('keeps history on conflict and does not apply stale results after leaving the campaign', async () => {
    useHistoryStore.setState({ undoStack: ['first'] });
    vi.mocked(replayAnnotationAction).mockRejectedValueOnce(new Error('Changed elsewhere'));
    await replayLabelling(true);
    expect(useHistoryStore.getState().undoStack).toEqual(['first']);
    expect(handleError).toHaveBeenCalled();
    const revision = useWorkStore.getState().annotationRevision;
    let resolve!: (value: ReturnType<typeof apiSuccess<AnnotationActionOut>>) => void;
    const response = new Promise<ReturnType<typeof apiSuccess<AnnotationActionOut>>>((done) => {
      resolve = done;
    });
    vi.mocked(replayAnnotationAction).mockReturnValueOnce(response);
    const pending = replayLabelling(true);
    stopTracking!();
    stopTracking = trackLabellingHistory(8);
    resolve(apiSuccess({ annotations: [makeAnnotation()], deleted_ids: [] }));
    await pending;
    expect(useHistoryStore.getState().undoStack).toEqual([]);
    expect(useWorkStore.getState().annotationRevision).toBe(revision);
  });
});
