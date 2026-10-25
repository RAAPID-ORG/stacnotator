import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '~/api/client';
import type { TaskOut, CampaignOutFull } from '~/api/client';
import { buildImageryCatalog } from '../../campaign/imagery';
import {
  apiSuccess,
  makeCampaign,
  makeSettings,
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
  return { ...actual, claimTask: vi.fn(), annotateTask: vi.fn() };
});

const FILTER = {
  assignedTo: [],
  statuses: ['pending' as const],
  selectedLabelIds: [],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

/** Seeds the campaign store the way a load would, then the task session. */
function seed(campaign: CampaignOutFull, tasks: TaskOut[]): void {
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
// already on it, so useClaims' requestClaim no-ops without hitting the network
// stub (isClaimable is false once a task carries any annotation).
const NOT_ALLOWED_TASK: TaskOut = makeTask({
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
      settings: makeSettings({
        labelling_policy: {
          explore: { kinds: ['anyone'] },
          assigned_tasks: { kinds: ['anyone'] },
          complete_assigned: { kinds: ['anyone'] },
          modify_others: { kinds: ['admins'] },
          unassigned_tasks: { kinds: [] },
        },
        labels: [{ id: 5, name: 'water', geometry_type: 'polygon' }],
      }),
    });
    seed(campaign, [NOT_ALLOWED_TASK]);

    render(<TaskControls />);

    expect(await screen.findByTestId('policy-not-allowed-notice')).toBeTruthy();
    const submitButton = screen.getByRole('button', { name: /submit/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
  });

  it('allows labelling and hides the notice when the policy permits it', async () => {
    const campaign = makeCampaign({
      settings: makeSettings({
        labelling_policy: {
          explore: { kinds: ['anyone'] },
          assigned_tasks: { kinds: ['anyone'] },
          complete_assigned: { kinds: ['anyone'] },
          modify_others: { kinds: ['admins'] },
          unassigned_tasks: { kinds: ['anyone'] },
        },
        labels: [{ id: 5, name: 'water', geometry_type: 'polygon' }],
      }),
    });
    seed(campaign, [NOT_ALLOWED_TASK]);

    render(<TaskControls />);

    expect(await screen.findByText('Water')).toBeTruthy();
    expect(screen.queryByTestId('policy-not-allowed-notice')).toBeNull();
  });
});

const OPEN_TASK: TaskOut = makeTask({ id: 2, annotation_number: 2 });

const OPEN_POLICY = makeCampaign({
  settings: makeSettings({
    labelling_policy: {
      explore: { kinds: ['anyone'] },
      assigned_tasks: { kinds: ['anyone'] },
      complete_assigned: { kinds: ['anyone'] },
      modify_others: { kinds: ['admins'] },
      unassigned_tasks: { kinds: ['anyone'] },
    },
    labels: [{ id: 5, name: 'water', geometry_type: 'polygon' }],
  }),
});

// A claim is advisory. Somebody else holding the task is worth showing, but
// it must not move the user off a task they are entitled to label.
describe('TaskControls claim conflict', () => {
  it('stays on a task somebody else holds instead of skipping past it', async () => {
    vi.mocked(api.claimTask).mockResolvedValue(
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

    await waitFor(() => expect(api.claimTask).toHaveBeenCalled());
    expect(alerts).toEqual([]);
    expect(useTasksStore.getState().currentIndex).toBe(0);
  });
});

// A draw task is answered by the shapes drawn around it, so the panel swaps
// the label form for the drawing tools and Done records that answer.
describe('TaskControls draw task', () => {
  it('finishes the task as drawn, with no label', async () => {
    vi.mocked(api.claimTask).mockResolvedValue(
      apiSuccess(makeClaimTaskResponse({ task_id: OPEN_TASK.id, claimed: true }))
    );
    vi.mocked(api.annotateTask).mockResolvedValue(
      apiSuccess({
        annotation: makeTaskAnnotation({ id: 11, label_id: null, outcome: 'drawn' }),
        task_status: 'done',
        assignment_status: 'done',
      })
    );
    seed(makeCampaign({ settings: { ...OPEN_POLICY.settings, task_output: 'draw' } }), [OPEN_TASK]);

    render(<TaskControls />);
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    await waitFor(() => expect(api.annotateTask).toHaveBeenCalled());
    expect(vi.mocked(api.annotateTask).mock.calls[0][0].body).toMatchObject({
      label_id: null,
      outcome: 'drawn',
    });
  });

  it('turns Nothing here off once this user has drawn on the task', async () => {
    seed(makeCampaign({ settings: { ...OPEN_POLICY.settings, task_output: 'draw' } }), [
      { ...OPEN_TASK, drawn_by_user_ids: ['u1'] },
    ]);

    render(<TaskControls />);

    const nothingHere = await screen.findByRole('button', { name: 'Nothing here' });
    expect((nothingHere as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('TaskControls validate toggle', () => {
  const withEmbeddings = (embedding_year: number | null, embedding_status: string) =>
    makeCampaign({
      embedding_status,
      settings: makeSettings({
        embedding_year,
        labels: [{ id: 5, name: 'water', geometry_type: 'polygon' }],
      }),
    });

  it('is offered once the campaign has its embeddings', async () => {
    seed(withEmbeddings(2023, 'ready'), [NOT_ALLOWED_TASK]);
    render(<TaskControls />);
    expect(await screen.findByText('Validate')).toBeTruthy();
  });

  it('is hidden without embeddings or while they are computed', async () => {
    for (const [year, status] of [
      [null, 'ready'],
      [2023, 'registering'],
    ] as const) {
      seed(withEmbeddings(year, status), [NOT_ALLOWED_TASK]);
      const { unmount } = render(<TaskControls />);
      expect(await screen.findByText('Water')).toBeTruthy();
      expect(screen.queryByText('Validate')).toBeNull();
      unmount();
    }
  });
});
