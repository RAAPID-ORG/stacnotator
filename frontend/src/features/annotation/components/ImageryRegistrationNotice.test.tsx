import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ImageryRegistrationNotice } from './ImageryRegistrationNotice';

it('centers registration feedback within its map without blocking interaction', () => {
  render(<ImageryRegistrationNotice />);
  const notice = screen.getByRole('status');
  expect(notice.textContent).toContain('Imagery will appear automatically');
  for (const className of [
    'absolute',
    'left-1/2',
    'top-1/2',
    '-translate-x-1/2',
    '-translate-y-1/2',
    'text-center',
    'pointer-events-none',
  ]) {
    expect(notice.classList.contains(className)).toBe(true);
  }
});
