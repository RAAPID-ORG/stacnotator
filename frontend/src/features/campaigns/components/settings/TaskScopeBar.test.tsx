import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TaskSetOut } from '~/api/client';
import { TaskScopeBar } from './TaskScopeBar';

const taskSets: TaskSetOut[] = [
  { id: 1, name: 'Training', created_at: '2024-01-01', num_tasks: 12, num_labeled: 0 },
  { id: 2, name: 'Validation', created_at: '2024-01-01', num_tasks: 8, num_labeled: 0 },
];

describe('TaskScopeBar', () => {
  it('switches between all tasks and a set, and selects a newly created set', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCreateSet = vi.fn().mockResolvedValue(3);
    render(
      <TaskScopeBar
        scope="all"
        taskSets={taskSets}
        totalTasks={20}
        onSelect={onSelect}
        onCreateSet={onCreateSet}
      />
    );
    await user.click(screen.getByRole('tab', { name: 'Validation 8' }));
    expect(onSelect).toHaveBeenLastCalledWith(2);
    await user.click(screen.getByRole('tab', { name: 'All tasks 20' }));
    expect(onSelect).toHaveBeenLastCalledWith('all');
    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith(2);
    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith('all');
    await user.click(screen.getByRole('button', { name: 'New set' }));
    await user.type(screen.getByRole('textbox'), '  Review  ');
    await user.click(screen.getByRole('button', { name: 'Create set' }));
    expect(onCreateSet).toHaveBeenCalledWith('Review');
    expect(onSelect).toHaveBeenLastCalledWith(3);
  });

  it('saves a rename explicitly and protects managed and last remaining sets', async () => {
    const user = userEvent.setup();
    const onRenameSet = vi.fn().mockResolvedValue(undefined);
    const props = {
      scope: 1,
      taskSets,
      totalTasks: 20,
      onSelect: vi.fn(),
      onRenameSet,
      onDeleteSet: vi.fn(),
    };
    const { rerender } = render(<TaskScopeBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Rename set' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New name');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRenameSet).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Rename set' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New name{Enter}');
    expect(onRenameSet).toHaveBeenCalledWith(1, 'New name');

    rerender(<TaskScopeBar {...props} lockedSetIds={new Set([1])} />);
    expect(screen.queryByRole('button', { name: 'Rename set' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete set' })).toBeNull();
    rerender(<TaskScopeBar {...props} taskSets={[taskSets[0]]} />);
    expect(screen.getByRole('button', { name: 'Delete set' }).hasAttribute('disabled')).toBe(true);
  });
});
