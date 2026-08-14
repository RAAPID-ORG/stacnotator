import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelHost } from './PanelHost';
import type { PanelDef } from '../panels/panels';

describe('PanelHost', () => {
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
