import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CenterCrosshair } from './CenterCrosshair';
import { useCampaignStore } from '../stores/campaign';
import { useImageryStore } from '../stores/imagery';

const setMode = (workMode: 'explore' | 'tasks') => useCampaignStore.setState({ workMode });

describe('CenterCrosshair', () => {
  beforeEach(() => {
    setMode('explore');
    useImageryStore.getState().setCrosshair(false);
  });

  it('stays off until it is asked for', () => {
    render(<CenterCrosshair />);
    expect(screen.queryByTestId('center-crosshair')).toBeNull();
  });

  // The reported bug: toggling in Explore did nothing, because the crosshair
  // was drawn from the task focus and Explore has none.
  it('shows in Explore once toggled on', () => {
    useImageryStore.getState().toggleCrosshair();
    render(<CenterCrosshair />);
    expect(screen.getByTestId('center-crosshair')).toBeTruthy();
  });

  // Tasks draws its own crosshair on the task's location, as a map feature.
  it('leaves the Tasks crosshair to the map layer', () => {
    setMode('tasks');
    useImageryStore.getState().setCrosshair(true);
    render(<CenterCrosshair />);
    expect(screen.queryByTestId('center-crosshair')).toBeNull();
  });
});
