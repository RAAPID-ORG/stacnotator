import { act, fireEvent, render, screen, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHotkeys } from '../../hotkeys';
import { INLINE_ICON_NAMES, TourOverlay } from './TourOverlay';
import { buildTourSteps } from './steps';

let unregister: (() => void) | null = null;

afterEach(() => {
  unregister?.();
  unregister = null;
  vi.useRealTimers();
});

function renderTour(props: Partial<Parameters<typeof TourOverlay>[0]> = {}) {
  return render(
    <TourOverlay
      open
      variant="tasks"
      hasTimeseries={false}
      hasFormFields={false}
      onClose={props.onClose ?? (() => {})}
      {...props}
    />
  );
}

describe('TourOverlay', () => {
  it('opens on the first step and reports the step count', () => {
    renderTour();
    expect(screen.getByText('Welcome to STACNotator!')).toBeDefined();
    expect(screen.getByText(/^Step 1 of /)).toBeDefined();
  });

  it('ticks off a practice step from the binding the user actually fired', () => {
    renderHook(() =>
      useHotkeys(
        [
          { key: 'a', help: 'Previous slice', run: () => {} },
          { key: 'd', help: 'Next slice', run: () => {} },
        ],
        []
      )
    );

    renderTour();

    // Walk to the "Practice: Navigate Slices" step.
    while (screen.queryByText('Practice: Navigate Slices') === null) {
      fireEvent.click(screen.getByTestId('tour-next'));
    }
    expect(screen.getByTestId('tour-action-hint').getAttribute('data-fulfilled')).toBe('false');
    expect(screen.getByTestId('tour-next').hasAttribute('disabled')).toBe(true);

    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.getByTestId('tour-action-hint').getAttribute('data-fulfilled')).toBe('false');

    fireEvent.keyDown(window, { key: 'd' });
    expect(screen.getByTestId('tour-action-hint').getAttribute('data-fulfilled')).toBe('true');
    expect(screen.getByTestId('tour-next').hasAttribute('disabled')).toBe(false);
  });

  it('broadens the task filter on open and restores it on close', () => {
    const onBroadenFilter = vi.fn();
    const onRestoreFilter = vi.fn();
    const onClose = vi.fn();

    renderTour({ needsBroaderFilter: true, onBroadenFilter, onRestoreFilter, onClose });
    expect(onBroadenFilter).toHaveBeenCalledTimes(1);
    expect(onRestoreFilter).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Skip Tour'));
    expect(onRestoreFilter).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderTour({ onClose });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    renderTour({ open: false });
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });
});

it('can draw every control its copy points at', () => {
  // A token with no icon behind it renders nothing at all, leaving a hole
  // mid-sentence that no other test would notice.
  const known = new Set<string>(INLINE_ICON_NAMES);
  for (const variant of ['tasks', 'explore'] as const) {
    const steps = buildTourSteps(variant, { hasTimeseries: true, hasFormFields: true });
    const copy = JSON.stringify(steps);
    for (const [, name] of copy.matchAll(/\{\{icon:(.*?)\}\}/g)) {
      expect(known, `${variant} uses icon "${name}"`).toContain(name);
    }
  }
});
