import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnnotationTaskOut, TaskSetOut } from '~/api/client';
import type { TaskStatus } from '../../campaign/annotation';
import { makeCampaign, makeTask } from '~/features/annotation/testing/fixtures';
import { useCampaignStore } from '../../stores/campaign';
import { UNLABELLED } from '../../campaign/tasks';
import { TaskFilterPanel } from './TaskFilterPanel';

const TASKS: AnnotationTaskOut[] = [
  makeTask({ id: 1, assignments: [{ user_id: 'u1', status: 'pending' }] }),
  makeTask({ id: 2, assignments: [] }),
];

const TASK_SETS: TaskSetOut[] = [];

const BASE_FILTER = {
  assignedTo: [] as string[],
  statuses: ['pending'] as TaskStatus[],
  selectedLabelIds: [] as number[],
  selectedConfidences: [] as number[],
  flaggedOnly: false,
  taskSetId: null,
};

describe('TaskFilterPanel', () => {
  it('materializes the implicit "all" set and drops the unassigned id when unchecked', () => {
    const onTaskFilterChange = vi.fn();
    render(
      <TaskFilterPanel
        tasks={TASKS}
        taskSets={TASK_SETS}
        taskFilter={BASE_FILTER}
        onTaskFilterChange={onTaskFilterChange}
        currentUserId="u1"
        isReviewMode={false}
      />
    );

    // assignedTo=[] reads as "all" (every checkbox checked, including
    // Unassigned); unchecking it materializes the remaining ids explicitly.
    fireEvent.click(screen.getByLabelText('Unassigned'));

    expect(onTaskFilterChange).toHaveBeenCalledWith({ assignedTo: ['u1'] });
  });

  it('calls onTaskFilterChange with currentUserId when clicking Mine', () => {
    const onTaskFilterChange = vi.fn();
    render(
      <TaskFilterPanel
        tasks={TASKS}
        taskSets={TASK_SETS}
        taskFilter={BASE_FILTER}
        onTaskFilterChange={onTaskFilterChange}
        currentUserId="u1"
        isReviewMode={false}
      />
    );

    fireEvent.click(screen.getByText('Mine'));

    expect(onTaskFilterChange).toHaveBeenCalledWith({ assignedTo: ['u1'] });
  });

  it('flips the real session store into review mode when the conflicting status is selected', () => {
    const onTaskFilterChange = vi.fn();
    useCampaignStore.getState().setReviewMode(false);

    render(
      <TaskFilterPanel
        tasks={TASKS}
        taskSets={TASK_SETS}
        taskFilter={BASE_FILTER}
        onTaskFilterChange={onTaskFilterChange}
        currentUserId="u1"
        isReviewMode
      />
    );

    fireEvent.click(screen.getByLabelText('Conflicting'));

    expect(useCampaignStore.getState().isReviewMode).toBe(true);
    expect(onTaskFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: expect.arrayContaining(['pending', 'conflicting']) })
    );
  });

  it('calls onTaskFilterChange when toggling the flagged-only filter', () => {
    const onTaskFilterChange = vi.fn();
    render(
      <TaskFilterPanel
        tasks={TASKS}
        taskSets={TASK_SETS}
        taskFilter={BASE_FILTER}
        onTaskFilterChange={onTaskFilterChange}
        currentUserId="u1"
        isReviewMode
      />
    );

    fireEvent.click(screen.getByText('Flagged only'));

    expect(onTaskFilterChange).toHaveBeenCalledWith({ flaggedOnly: true });
  });
  it('toggles a label and the skipped chip in the review filters', () => {
    const onTaskFilterChange = vi.fn();
    useCampaignStore.setState({
      campaign: makeCampaign({
        settings: {
          ...makeCampaign().settings,
          labels: [
            { id: 3, name: 'Cropland', geometry_type: 'polygon' },
            { id: 4, name: 'Water', geometry_type: 'polygon' },
          ],
        },
      }),
    });

    const { rerender } = render(
      <TaskFilterPanel
        tasks={TASKS}
        taskSets={TASK_SETS}
        taskFilter={BASE_FILTER}
        onTaskFilterChange={onTaskFilterChange}
        currentUserId="u1"
        isReviewMode
      />
    );

    fireEvent.click(screen.getByText('Cropland'));
    expect(onTaskFilterChange).toHaveBeenCalledWith({ selectedLabelIds: [3] });

    rerender(
      <TaskFilterPanel
        tasks={TASKS}
        taskSets={TASK_SETS}
        taskFilter={{ ...BASE_FILTER, selectedLabelIds: [3] }}
        onTaskFilterChange={onTaskFilterChange}
        currentUserId="u1"
        isReviewMode
      />
    );

    // "Skipped" is also a status checkbox, so scope to the label row.
    fireEvent.click(within(screen.getByTestId('task-label-filter')).getByText('Skipped'));
    expect(onTaskFilterChange).toHaveBeenCalledWith({ selectedLabelIds: [3, UNLABELLED] });

    fireEvent.click(screen.getByText('Cropland'));
    expect(onTaskFilterChange).toHaveBeenCalledWith({ selectedLabelIds: [] });
  });

  it('leaves the label filter out of task mode, where nothing is labelled yet', () => {
    render(
      <TaskFilterPanel
        tasks={TASKS}
        taskSets={TASK_SETS}
        taskFilter={BASE_FILTER}
        onTaskFilterChange={vi.fn()}
        currentUserId="u1"
        isReviewMode={false}
      />
    );

    expect(screen.queryByTestId('task-label-filter')).toBeNull();
  });
});
