import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { TaskModeReview } from './TaskModeReview';

vi.mock('~/api/client/sdk.gen', () => ({}));

const makeTasks = (count: number): AnnotationTaskOut[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    annotation_number: i + 1,
    task_set_id: 1,
    task_status: 'pending',
    geometry: { geometry: 'POINT(10 50)' },
    assignments: [],
    annotations: [],
    claimed_by_user_id: null,
    claimed_at: null,
    claimed_by_display_name: null,
    has_embedding: false,
  })) as unknown as AnnotationTaskOut[];

const renderTable = (count: number) =>
  renderWithQuery(
    <MemoryRouter>
      <TaskModeReview campaignId={1} tasks={makeTasks(count)} taskSets={[]} embedded selectable />
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

  it('cannot page past either end', async () => {
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
