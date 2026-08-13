import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LabelBase } from '~/api/client';
import { LabelGrid } from './LabelGrid';

const LABELS: LabelBase[] = [
  { id: 1, name: 'water' },
  { id: 2, name: 'forest' },
];

/** LabelGrid is a controlled component (selectedId lives in useWorkStore in
 *  the real app) - wrap it with local state to exercise select/deselect. */
function ControlledLabelGrid() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  return <LabelGrid labels={LABELS} selectedId={selectedId} onSelect={setSelectedId} />;
}

describe('LabelGrid', () => {
  it('renders every label', () => {
    render(<LabelGrid labels={LABELS} selectedId={null} onSelect={() => {}} />);

    expect(screen.getByText('Water')).toBeTruthy();
    expect(screen.getByText('Forest')).toBeTruthy();
  });

  it('clicking a label selects it', () => {
    render(<ControlledLabelGrid />);

    fireEvent.click(screen.getByText('Water'));

    expect(screen.getByText('✓ Water')).toBeTruthy();
  });

  it('clicking the already-selected label deselects it', () => {
    render(<ControlledLabelGrid />);

    fireEvent.click(screen.getByText('Water'));
    fireEvent.click(screen.getByText('✓ Water'));

    expect(screen.queryByText('✓ Water')).toBeNull();
    expect(screen.getByText('Water')).toBeTruthy();
  });

  it('clicking a different label switches the selection rather than deselecting', () => {
    render(<ControlledLabelGrid />);

    fireEvent.click(screen.getByText('Water'));
    fireEvent.click(screen.getByText('Forest'));

    expect(screen.getByText('✓ Forest')).toBeTruthy();
    expect(screen.queryByText('✓ Water')).toBeNull();
  });
});
