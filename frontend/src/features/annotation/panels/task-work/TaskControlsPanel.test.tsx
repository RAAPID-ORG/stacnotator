import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as api from '~/api/client';
import type { AnnotationTaskOut, CampaignOutFull } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  makeCampaign,
  makeTask,
  makeTaskAnnotation,
} from '~/features/annotation/core/catalog/testHelpers';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useSessionStore, useWorkStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../registry';
import { TaskControlsPanel } from './TaskControlsPanel';
import { initTaskList, resetTaskList } from './taskListBus';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, claimAnnotationTask: vi.fn() };
});

const FILTER = {
  assignedTo: [],
  statuses: ['pending' as const],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

function ctxFor(campaign: CampaignOutFull): ComposeCtx {
  return {
    campaign,
    catalog: buildCatalog(campaign),
    view: null,
    mode: 'tasks',
    isMobile: false,
  };
}

// No assignments (unassigned_tasks gates it) and someone else's annotation
// already on it, so useClaims' claimTask no-ops without hitting the network
// stub (isClaimable is false once a task carries any annotation).
const NOT_ALLOWED_TASK: AnnotationTaskOut = makeTask({
  id: 1,
  annotation_number: 1,
  annotations: [makeTaskAnnotation({ id: 9, label_id: 5, created_by_user_id: 'someone-else' })],
});

const alerts: string[] = [];
beforeEach(() => {
  alerts.length = 0;
  useLayoutStore.setState({ showAlert: (message) => alerts.push(message) });
});

afterEach(() => {
  resetTaskList();
  useWorkStore.getState().resetForm();
  useSessionStore.getState().setReviewMode(false);
});

describe('TaskControlsPanel labelling policy', () => {
  it('shows the not-allowed notice and disables Submit when unassigned_tasks denies the viewer', async () => {
    const campaign = makeCampaign({
      settings: {
        bbox_west: -10,
        bbox_south: -20,
        bbox_east: 10,
        bbox_north: 20,
        labelling_policy: {
          explore: { kinds: ['anyone'] },
          assigned_tasks: { kinds: ['anyone'] },
          complete_assigned: { kinds: ['anyone'] },
          unassigned_tasks: { kinds: [] },
        },
        labels: [{ id: 5, name: 'water' }],
      },
    });
    initTaskList([NOT_ALLOWED_TASK], [], FILTER, 'u1', 0);

    render(<TaskControlsPanel ctx={ctxFor(campaign)} />);

    expect(await screen.findByTestId('policy-not-allowed-notice')).toBeTruthy();
    const submitButton = screen.getByRole('button', { name: /submit/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
  });

  it('allows labelling and hides the notice when the policy permits it', async () => {
    const campaign = makeCampaign({
      settings: {
        bbox_west: -10,
        bbox_south: -20,
        bbox_east: 10,
        bbox_north: 20,
        labelling_policy: {
          explore: { kinds: ['anyone'] },
          assigned_tasks: { kinds: ['anyone'] },
          complete_assigned: { kinds: ['anyone'] },
          unassigned_tasks: { kinds: ['anyone'] },
        },
        labels: [{ id: 5, name: 'water' }],
      },
    });
    initTaskList([NOT_ALLOWED_TASK], [], FILTER, 'u1', 0);

    render(<TaskControlsPanel ctx={ctxFor(campaign)} />);

    expect(await screen.findByText('Water')).toBeTruthy();
    expect(screen.queryByTestId('policy-not-allowed-notice')).toBeNull();
  });
});

const OPEN_TASK: AnnotationTaskOut = makeTask({ id: 2, annotation_number: 2 });

const OPEN_POLICY = makeCampaign({
  settings: {
    bbox_west: -10,
    bbox_south: -20,
    bbox_east: 10,
    bbox_north: 20,
    labelling_policy: {
      explore: { kinds: ['anyone'] },
      assigned_tasks: { kinds: ['anyone'] },
      complete_assigned: { kinds: ['anyone'] },
      unassigned_tasks: { kinds: ['anyone'] },
    },
    labels: [{ id: 5, name: 'water' }],
  },
});

// A claim conflict needs a toast: a 409 means someone else took the task
// first, and advancing without saying so reads as the app skipping tasks at
// random.
describe('TaskControlsPanel claim conflict', () => {
  it('tells the user why it moved on when someone else claimed the task first', async () => {
    vi.mocked(api.claimAnnotationTask).mockResolvedValue({
      data: undefined,
      error: { detail: [] },
      request: new Request('http://test'),
      response: new Response(null, { status: 409 }),
    });
    initTaskList([OPEN_TASK], [], FILTER, 'u1', 0);

    render(<TaskControlsPanel ctx={ctxFor(OPEN_POLICY)} />);

    await waitFor(() =>
      expect(alerts).toContainEqual(expect.stringContaining('already working on that task'))
    );
  });
});
