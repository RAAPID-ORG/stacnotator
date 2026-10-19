import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelHost } from './PanelHost';
import type { PanelDef } from '../panels/panels';

describe('PanelHost', () => {
  it('uses the expensive body as a drag placeholder and hides only through the header button', () => {
    const onHidePanel = vi.fn();
    const panel: PanelDef = {
      id: '10',
      role: 'imagery-window',
      hideTarget: true,
      hidable: true,
      body: <div>Imagery map</div>,
    };
    const { rerender } = render(<PanelHost panel={panel} editing onHidePanel={onHidePanel} />);
    const placeholder = screen.getByTestId('edit-placeholder-10');
    expect(screen.queryByText('Imagery map')).toBeNull();
    fireEvent.click(placeholder);
    expect(onHidePanel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Hide 10' }));
    expect(onHidePanel).toHaveBeenCalledWith('10');

    rerender(<PanelHost panel={panel} editing={false} onHidePanel={onHidePanel} />);
    expect(screen.queryByTestId('edit-placeholder-10')).toBeNull();
    expect(screen.getByText('Imagery map')).toBeTruthy();
  });

  it('replaces a headerless timeline with a full drag header while editing, then restores it', () => {
    const panel: PanelDef = {
      id: 'timeline',
      role: 'imagery-timeline',
      title: 'Timeline',
      headerless: true,
      hideTarget: true,
      body: <div>slider</div>,
    };
    const { container, rerender } = render(<PanelHost panel={panel} editing={false} />);
    expect(container.querySelector('.panel-drag-handle')).toBeNull();
    expect(screen.getByText('slider').textContent).toBe('slider');

    rerender(<PanelHost panel={panel} editing />);
    expect(container.querySelector('.panel-drag-handle')?.textContent).toBe('Timeline');
    expect(screen.queryByText('slider')).toBeNull();
    expect(container.querySelector('.panel-body')).toBeNull();
    expect(container.querySelector('.panel-drag-handle')?.classList.contains('editable')).toBe(
      true
    );

    rerender(<PanelHost panel={panel} editing={false} />);
    expect(container.querySelector('.panel-drag-handle')).toBeNull();
    expect(screen.getByText('slider').textContent).toBe('slider');
  });

  it('does not fire onHeaderClick when the header hide button is clicked', () => {
    const onHeaderClick = vi.fn();
    const onHidePanel = vi.fn();
    const panel: PanelDef = {
      id: 'a',
      role: 'a',
      title: 'A',
      body: <div>body</div>,
      hidable: true,
      onHeaderClick,
    };

    render(<PanelHost panel={panel} editing onHidePanel={onHidePanel} />);

    fireEvent.click(screen.getByTestId('hide-panel-a'));

    expect(onHidePanel).toHaveBeenCalledWith('a');
    expect(onHeaderClick).not.toHaveBeenCalled();
  });

  it('still fires onHeaderClick for clicks elsewhere in the header', () => {
    const onHeaderClick = vi.fn();
    const panel: PanelDef = {
      id: 'a',
      role: 'a',
      title: 'A',
      body: <div>body</div>,
      onHeaderClick,
    };

    render(<PanelHost panel={panel} editing={false} />);

    fireEvent.click(screen.getByText('A'));

    expect(onHeaderClick).toHaveBeenCalledTimes(1);
  });
});
