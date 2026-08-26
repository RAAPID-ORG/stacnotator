import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton, SkeletonRows } from './Skeleton';

describe('Skeleton', () => {
  // The flash it exists to prevent: visible immediately, then gone in under
  // 200ms when the query was fast. The reveal is deferred in CSS instead, so
  // the block still holds its space and nothing jumps on the swap.
  it('defers its own reveal rather than relying on the caller to delay it', () => {
    const { container } = render(<Skeleton className="h-7 w-52" />);
    const block = container.firstElementChild;
    expect(block?.className).toContain('motion-skeleton');
    // Sizing still comes from the caller, so the space is reserved on mount.
    expect(block?.className).toContain('h-7');
  });

  it('gives the composed placeholders the same treatment', () => {
    render(<SkeletonRows count={2} />);
    const rows = screen.getByRole('status');
    expect(rows.querySelectorAll('.motion-skeleton').length).toBeGreaterThan(0);
  });
});
