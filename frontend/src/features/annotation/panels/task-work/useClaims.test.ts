import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '~/api/client';
import type { AnnotationTaskOut } from '~/api/client';
import {
  apiSuccess,
  makeClaimTaskResponse,
  makeTask,
  makeTaskAnnotation,
} from '~/features/annotation/core/catalog/testHelpers';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { claimTask, useClaims } from './useClaims';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, claimAnnotationTask: vi.fn() };
});

const UNCLAIMED_TASK: AnnotationTaskOut = makeTask({
  id: 1,
  annotation_number: 1,
  task_status: 'pending',
});

const alerts: string[] = [];
beforeEach(() => {
  vi.mocked(api.claimAnnotationTask).mockReset();
  alerts.length = 0;
  useLayoutStore.setState({ showAlert: (message) => alerts.push(message) });
});

describe('claimTask', () => {
  it('claims an unassigned task and records our soft claim', async () => {
    vi.mocked(api.claimAnnotationTask).mockResolvedValue(
      apiSuccess(makeClaimTaskResponse({ task_id: 1, claimed_at: '2026-01-01T00:00:00Z' }))
    );

    const result = await claimTask({
      campaignId: 1,
      task: UNCLAIMED_TASK,
      currentUserId: 'u1',
      now: 0,
    });

    expect(result.status).toBe('claimed');
    expect(result.task?.assignments).toEqual([
      { user_id: 'u1', status: 'pending', claimed_at: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('a 409 (someone else claimed it first) reports skip', async () => {
    vi.mocked(api.claimAnnotationTask).mockResolvedValue({
      data: undefined,
      error: { detail: [] },
      request: new Request('http://test'),
      response: new Response(null, { status: 409 }),
    });

    const result = await claimTask({
      campaignId: 1,
      task: UNCLAIMED_TASK,
      currentUserId: 'u1',
      now: 0,
    });

    expect(result.status).toBe('skip');
    expect(result.task).toBeUndefined();
  });

  it('is a no-op for a task we neither hold nor can claim (already labeled)', async () => {
    const labeledTask: AnnotationTaskOut = {
      ...UNCLAIMED_TASK,
      annotations: [makeTaskAnnotation({ id: 5, label_id: 2, created_by_user_id: 'someone-else' })],
    };

    const result = await claimTask({
      campaignId: 1,
      task: labeledTask,
      currentUserId: 'u1',
      now: 0,
    });

    expect(result.status).toBe('noop');
    expect(api.claimAnnotationTask).not.toHaveBeenCalled();
  });

  it('renews our own soft claim rather than skipping', async () => {
    const heldTask: AnnotationTaskOut = {
      ...UNCLAIMED_TASK,
      assignments: [{ user_id: 'u1', status: 'pending', claimed_at: '2026-01-01T00:00:00Z' }],
    };
    vi.mocked(api.claimAnnotationTask).mockResolvedValue(
      apiSuccess(makeClaimTaskResponse({ task_id: 1, claimed_at: '2026-01-01T00:10:00Z' }))
    );

    const result = await claimTask({
      campaignId: 1,
      task: heldTask,
      currentUserId: 'u1',
      now: 600_000,
    });

    expect(result.status).toBe('claimed');
    expect(result.task?.assignments).toEqual([
      { user_id: 'u1', status: 'pending', claimed_at: '2026-01-01T00:10:00Z' },
    ]);
  });
});

describe('useClaims failure handling', () => {
  const options = (overrides: Partial<Parameters<typeof useClaims>[0]> = {}) => ({
    campaignId: 1,
    taskId: 1,
    currentUserId: 'u1',
    isReviewMode: false,
    getTask: () => UNCLAIMED_TASK,
    onClaimed: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  });

  // The rejection escaping instead of being handled is a failure of this test
  // too: vitest fails the run on an unhandled rejection.
  it('reports a failed claim rather than letting the rejection escape', async () => {
    vi.mocked(api.claimAnnotationTask).mockRejectedValue(new Error('network down'));
    const opts = options();

    renderHook(() => useClaims(opts));

    await waitFor(() => {
      expect(alerts).toContainEqual(expect.stringContaining('network down'));
    });

    expect(opts.onClaimed).not.toHaveBeenCalled();
    expect(opts.onSkip).not.toHaveBeenCalled();
  });

  it('says nothing about a claim that fails after we navigated away', async () => {
    let reject: (error: Error) => void = () => {};
    vi.mocked(api.claimAnnotationTask).mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }) as ReturnType<typeof api.claimAnnotationTask>
    );

    const { unmount } = renderHook(() => useClaims(options()));
    unmount();
    reject(new Error('network down'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(alerts).toEqual([]);
  });
});
