import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CampaignSummaryOut } from '~/api/client';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import type { TaskRow, TaskRowAnswer } from '~/shared/utils/taskSummary';
import { TaskModeReview } from './TaskModeReview';

vi.mock('~/api/client/sdk.gen', () => ({
  getTaskDetails: vi.fn(async () => ({
    data: {
      campaign_id: 1,
      tasks: [{ id: 1, annotations: [{ id: 7, form_values: { '3': 'muddy field' } }] }],
    },
  })),
}));

const makeTask = (i: number, annotations: TaskRowAnswer[] = []): TaskRow => ({
  id: i + 1,
  annotation_number: i + 1,
  task_set_id: 1,
  task_status: 'pending',
  claimed_by_user_id: null,
  claimed_at: null,
  claimed_by_display_name: null,
  lon: 10,
  lat: 50,
  nearby_annotation_count: 0,
  drawn_by_user_ids: [],
  assignments: [],
  annotations,
});

const makeTasks = (count: number): TaskRow[] =>
  Array.from({ length: count }, (_, i) => makeTask(i));

const renderTable = (count: number) =>
  renderWithQuery(
    <MemoryRouter>
      <TaskModeReview campaignId={1} tasks={makeTasks(count)} taskSets={[]} selectable />
    </MemoryRouter>
  );

const rowCount = () => screen.getAllByRole('row').length - 1; // minus the header row

const firstRowNumber = () => screen.getAllByRole('row')[1].textContent;

describe('TaskModeReview with a large task list', () => {
  it('paints one page of rows and says where you are', () => {
    renderTable(500);

    expect(rowCount()).toBeLessThan(500);
    expect(screen.getByText(/page 1 of 5/i)).toBeTruthy();
  });

  it('moves to the next page', async () => {
    const user = userEvent.setup();
    renderTable(500);
    const firstOfPageOne = firstRowNumber();

    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText(/page 2 of 5/i)).toBeTruthy();
    expect(firstRowNumber()).not.toBe(firstOfPageOne);
  });

  it('goes back to the previous page', async () => {
    const user = userEvent.setup();
    renderTable(500);
    const firstOfPageOne = firstRowNumber();

    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(screen.getByRole('button', { name: /previous/i }));

    expect(screen.getByText(/page 1 of 5/i)).toBeTruthy();
    expect(firstRowNumber()).toBe(firstOfPageOne);
  });

  // Renders 500 rows and clicks through them, which outlasts the default under a busy run.
  it('cannot page past either end', { timeout: 15_000 }, async () => {
    const user = userEvent.setup();
    renderTable(500);

    expect(screen.getByRole('button', { name: /previous/i }).hasAttribute('disabled')).toBe(true);

    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole('button', { name: /next/i }));
    }

    expect(screen.getByText(/page 5 of 5/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /next/i }).hasAttribute('disabled')).toBe(true);
  });

  it('selects every matching task, not just the painted ones', async () => {
    const user = userEvent.setup();
    renderTable(500);

    await user.click(screen.getAllByRole('checkbox')[0]);

    expect(screen.getByText('500 selected')).toBeTruthy();
  });

  it('leaves a short list alone', () => {
    renderTable(5);

    expect(rowCount()).toBe(5);
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
  });
});

const answer: TaskRowAnswer = {
  id: 7,
  created_by_user_id: 'u1',
  created_by_user_display_name: 'ana',
  created_by_user_email: null,
  label_id: 1,
  outcome: 'labelled',
  confidence: null,
  flagged_for_review: false,
  active_seconds: null,
  is_authoritative: false,
  counts_toward_completion: true,
  comment: null,
  flag_comment: null,
  answered_field_ids: ['3'],
};

const campaign: CampaignSummaryOut = {
  id: 1,
  project_id: 1,
  name: 'Crops',
  created_at: '2026-01-01T00:00:00Z',
  settings: {
    labels: [],
    bbox_west: 0,
    bbox_south: 0,
    bbox_east: 1,
    bbox_north: 1,
    embedding_year: null,
    guide_markdown: null,
    sample_extent_meters: null,
    labelling_policy: {
      explore: {},
      unassigned_tasks: {},
      assigned_tasks: {},
      complete_assigned: {},
      modify_others: {},
    },
    form_fields: [{ id: 3, title: 'Notes', type: 'text' }],
    research_sharing: false,
    task_output: 'classify',
  },
};

describe('TaskModeReview answers', () => {
  it('shows the centroid the summary carries', () => {
    renderTable(1);

    expect(screen.getByText('50.00000, 10.00000')).toBeTruthy();
  });

  it('reads the form values of a task only once its row is opened', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <MemoryRouter>
        <TaskModeReview
          campaign={campaign}
          campaignId={1}
          tasks={[makeTask(0, [answer]), makeTask(1)]}
          taskSets={[]}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('toggle-answers-2').hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByTestId('toggle-answers-1'));

    expect(await screen.findByText('muddy field')).toBeTruthy();
  });
});
