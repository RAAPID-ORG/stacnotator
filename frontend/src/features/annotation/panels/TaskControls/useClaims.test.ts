import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '~/api/client';
import type { AnnotationTaskOut } from '~/api/client';
import {
  apiSuccess,
  makeClaimTaskResponse,
  makeTask,
  makeTaskAnnotation,
} from '~/features/annotation/testing/fixtures';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { CLAIM_RENEW_MS, claimTask, useClaims } from './useClaims';

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
  it('claims a free task and records us as the holder', async () => {
    vi.mocked(api.claimAnnotationTask).mockResolvedValue(
      apiSuccess(makeClaimTaskResponse({ task_id: 1, claimed_at: '2026-01-01T00:00:00Z' }))
    );

    const result = await claimTask({
      campaignId: 1,
      task: UNCLAIMED_TASK,
      currentUserId: 'u1',
      now: 0,
    });

    expect(result?.claimed_by_user_id).toBe('u1');
    expect(result?.claimed_at).toBe('2026-01-01T00:00:00Z');
  });

  it('records who is on it when the claim goes to somebody else', async () => {
    vi.mocked(api.claimAnnotationTask).mockResolvedValue(
      apiSuccess(
        makeClaimTaskResponse({
          task_id: 1,
          claimed: false,
          claimed_at: '2026-01-01T00:00:00Z',
          holder_user_id: 'u2',
          holder_display_name: 'Ada',
        })
      )
    );

    const result = await claimTask({
      campaignId: 1,
      task: UNCLAIMED_TASK,
      currentUserId: 'u1',
      now: 0,
    });

    // Reported, not bounced: the user stays on the task and may still label it.
    expect(result?.claimed_by_user_id).toBe('u2');
    expect(result?.claimed_by_display_name).toBe('Ada');
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

    expect(result).toBeNull();
    expect(api.claimAnnotationTask).not.toHaveBeenCalled();
  });

  it('does not re-request a claim we took moments ago', async () => {
    const heldTask: AnnotationTaskOut = {
      ...UNCLAIMED_TASK,
      claimed_by_user_id: 'u1',
      claimed_at: new Date(0).toISOString(),
    };

    const result = await claimTask({
      campaignId: 1,
      task: heldTask,
      currentUserId: 'u1',
      now: 60_000,
    });

    expect(result).toBeNull();
    expect(api.claimAnnotationTask).not.toHaveBeenCalled();
  });

  it('renews our own claim once it is old enough to be worth refreshing', async () => {
    const heldTask: AnnotationTaskOut = {
      ...UNCLAIMED_TASK,
      claimed_by_user_id: 'u1',
      claimed_at: new Date(0).toISOString(),
    };
    vi.mocked(api.claimAnnotationTask).mockResolvedValue(
      apiSuccess(makeClaimTaskResponse({ task_id: 1, claimed_at: '2026-01-01T00:10:00Z' }))
    );

    const result = await claimTask({
      campaignId: 1,
      task: heldTask,
      currentUserId: 'u1',
      now: CLAIM_RENEW_MS,
    });

    expect(result?.claimed_at).toBe('2026-01-01T00:10:00Z');
  });

  it('leaves a task somebody else holds alone', async () => {
    const heldByOther: AnnotationTaskOut = {
      ...UNCLAIMED_TASK,
      claimed_by_user_id: 'u2',
      claimed_at: new Date(0).toISOString(),
    };

    const result = await claimTask({
      campaignId: 1,
      task: heldByOther,
      currentUserId: 'u1',
      now: 60_000,
    });

    expect(result).toBeNull();
    expect(api.claimAnnotationTask).not.toHaveBeenCalled();
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
