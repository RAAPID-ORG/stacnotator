import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as api from '~/api/client';
import type { AnnotationTaskOut, CampaignOutFull } from '~/api/client';
import { buildImageryCatalog } from '../../campaign/imagery';
import {
  apiSuccess,
  makeCampaign,
  makeClaimTaskResponse,
  makeTask,
  makeTaskAnnotation,
} from '~/features/annotation/testing/fixtures';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useCampaignStore } from '../../stores/campaign';
import { useWorkStore } from '../../stores/work';
import { TaskControls } from './TaskControls';
import { useTasksStore } from '../../stores/tasks';

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

/** Seeds the campaign store the way a load would, then the task session. */
function seed(campaign: CampaignOutFull, tasks: AnnotationTaskOut[]): void {
  const catalog = buildImageryCatalog(campaign);
  useCampaignStore.setState({
    campaign,
    catalog,
    view: null,
    workMode: 'tasks',
    isMobile: false,
    currentUserId: 'u1',
  });
  useTasksStore.getState().initialize({ tasks, taskSets: [], filter: FILTER, now: 0, catalog });
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
  useTasksStore.getState().reset();
  useWorkStore.getState().resetForm();
  useCampaignStore.getState().setReviewMode(false);
});

describe('TaskControls labelling policy', () => {
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
    seed(campaign, [NOT_ALLOWED_TASK]);

    render(<TaskControls />);

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
    seed(campaign, [NOT_ALLOWED_TASK]);

    render(<TaskControls />);

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

// A claim is advisory. Somebody else holding the task is worth showing, but
// it must not move the user off a task they are entitled to label.
describe('TaskControls claim conflict', () => {
  it('stays on a task somebody else holds instead of skipping past it', async () => {
    vi.mocked(api.claimAnnotationTask).mockResolvedValue(
      apiSuccess(
        makeClaimTaskResponse({
          task_id: OPEN_TASK.id,
          claimed: false,
          holder_user_id: 'someone-else',
          holder_display_name: 'Ada',
        })
      )
    );
    seed(OPEN_POLICY, [OPEN_TASK]);

    render(<TaskControls />);

    await waitFor(() => expect(api.claimAnnotationTask).toHaveBeenCalled());
    expect(alerts).toEqual([]);
    expect(useTasksStore.getState().currentIndex).toBe(0);
  });
});
