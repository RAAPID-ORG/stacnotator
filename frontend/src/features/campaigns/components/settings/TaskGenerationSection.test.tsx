import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskGenerationSection } from './TaskGenerationSection';

vi.mock('~/api/client', () => ({ generateTasksFromSampling: vi.fn() }));

const renderSection = () =>
  render(
    <TaskGenerationSection
      campaignId={1}
      taskSetId={1}
      onTasksGenerated={vi.fn()}
      onError={vi.fn()}
    />
  );

describe('TaskGenerationSection', () => {
  it('asks for a sample count for random sampling, and says nothing about a grid', () => {
    renderSection();

    expect(screen.getByLabelText(/number of samples/i)).toBeTruthy();
    expect(screen.queryByLabelText(/grid spacing/i)).toBeNull();
    expect(screen.queryByText(/random offset/i)).toBeNull();
  });

  it('swaps the count for a spacing and explains the grid once grid is chosen', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('radio', { name: /grid sampling/i }));

    expect(screen.getByLabelText(/grid spacing/i)).toBeTruthy();
    expect(screen.queryByLabelText(/number of samples/i)).toBeNull();
    // The three properties an annotator or reviewer has to know to defend the sample.
    expect(screen.getByText(/ground distance/i)).toBeTruthy();
    expect(screen.getByText(/random offset/i)).toBeTruthy();
    expect(screen.getByText(/random order/i)).toBeTruthy();
  });
});
