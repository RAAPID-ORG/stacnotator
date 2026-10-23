import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PointJumper } from './PointJumper';

function setup(found = true) {
  const onJump = vi.fn(() => found);
  const onNotFound = vi.fn();
  render(<PointJumper current={3} onJump={onJump} onNotFound={onNotFound} />);
  return { input: screen.getByLabelText('Current point'), onJump, onNotFound };
}

describe('PointJumper', () => {
  it('jumps on Enter and shows the current point again', async () => {
    const { input, onJump } = setup();
    await userEvent.type(input, '7{Enter}');

    expect(onJump).toHaveBeenCalledExactlyOnceWith(7);
    expect(input).toHaveProperty('value', '3');
  });

  it('jumps when the field is left, so a typed number is never left behind', async () => {
    const { input, onJump } = setup();
    await userEvent.type(input, '7');
    await userEvent.tab();

    expect(onJump).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('Escape cancels the edit', async () => {
    const { input, onJump } = setup();
    await userEvent.type(input, '7{Escape}');

    expect(onJump).not.toHaveBeenCalled();
    expect(input).toHaveProperty('value', '3');
  });

  it('reports a number outside the filter and reverts', async () => {
    const { input, onNotFound } = setup(false);
    await userEvent.type(input, '99{Enter}');

    expect(onNotFound).toHaveBeenCalledExactlyOnceWith(99);
    expect(input).toHaveProperty('value', '3');
  });

  it('ignores an empty field and non-digits', async () => {
    const { input, onJump } = setup();
    await userEvent.clear(input);
    await userEvent.type(input, 'ab{Enter}');

    expect(onJump).not.toHaveBeenCalled();
    expect(input).toHaveProperty('value', '3');
  });
});
