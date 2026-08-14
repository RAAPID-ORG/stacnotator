import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceLayout } from '../grid';
import { SaveDialogs } from './SaveDialogs';

const BASE: WorkspaceLayout = {
  main: {
    main: { i: 'main', x: 0, y: 0, w: 40, h: 20 },
    minimap: { i: 'minimap', x: 40, y: 0, w: 20, h: 10 },
    controls: { i: 'controls', x: 40, y: 10, w: 20, h: 10 },
    timeseries: {},
  },
  windows: {},
};

const MAIN_CHANGED: WorkspaceLayout = {
  ...BASE,
  main: { ...BASE.main, main: { ...BASE.main.main, x: 5 } },
};

describe('SaveDialogs', () => {
  it('shows the all-views warning when the main layout changed and more than one view exists', () => {
    const onSave = vi.fn();
    render(
      <SaveDialogs
        currentLayout={MAIN_CHANGED}
        savedLayout={BASE}
        viewsCount={2}
        canSaveDefault={false}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByTestId('save-menu-trigger'));
    fireEvent.click(screen.getByTestId('save-personal'));

    expect(screen.getByText('Main Layout Modified')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('skips the warning when there is only one view, even if the main layout changed', () => {
    const onSave = vi.fn();
    render(
      <SaveDialogs
        currentLayout={MAIN_CHANGED}
        savedLayout={BASE}
        viewsCount={1}
        canSaveDefault={false}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByTestId('save-menu-trigger'));
    fireEvent.click(screen.getByTestId('save-personal'));

    expect(screen.queryByText('Main Layout Modified')).toBeNull();
    expect(onSave).toHaveBeenCalledWith(false);
  });

  it('skips the warning when the main layout is unchanged, even with multiple views', () => {
    const onSave = vi.fn();
    render(
      <SaveDialogs
        currentLayout={BASE}
        savedLayout={BASE}
        viewsCount={2}
        canSaveDefault={false}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByTestId('save-menu-trigger'));
    fireEvent.click(screen.getByTestId('save-personal'));

    expect(screen.queryByText('Main Layout Modified')).toBeNull();
    expect(onSave).toHaveBeenCalledWith(false);
  });

  it('gates saving as default behind its own confirmation before the all-views warning', () => {
    const onSave = vi.fn();
    render(
      <SaveDialogs
        currentLayout={MAIN_CHANGED}
        savedLayout={BASE}
        viewsCount={2}
        canSaveDefault
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByTestId('save-menu-trigger'));
    fireEvent.click(screen.getByTestId('save-default'));
    expect(screen.getByText('Save as Default Layout?')).toBeTruthy();

    fireEvent.click(screen.getByText('Save Default'));
    expect(screen.getByText('Main Layout Modified')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Save Layout'));
    expect(onSave).toHaveBeenCalledWith(true);
  });

  it('only allows a shared default save while setting up the first view', () => {
    const onSave = vi.fn();
    render(
      <SaveDialogs
        currentLayout={BASE}
        savedLayout={BASE}
        viewsCount={1}
        canSaveDefault
        mustSaveDefault
        onSave={onSave}
      />
    );

    expect(screen.queryByTestId('save-menu-trigger')).toBeNull();
    expect(screen.queryByTestId('save-personal')).toBeNull();

    fireEvent.click(screen.getByTestId('save-required-default'));
    expect(screen.getByText('Save First View for Everyone?')).toBeTruthy();

    fireEvent.click(screen.getByText('Save for Everyone'));
    expect(onSave).toHaveBeenCalledWith(true);
  });
});
