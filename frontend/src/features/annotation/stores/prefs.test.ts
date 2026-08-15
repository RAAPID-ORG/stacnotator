import { beforeEach, describe, expect, it } from 'vitest';
import { usePrefsStore } from './prefs';

beforeEach(() => {
  localStorage.clear();
  usePrefsStore.setState({
    preloadTier: 'auto',
    skipConfirmDisabled: false,
    pinnedStart: {},
    toursSeen: [],
    labelStyles: {},
    legendOverrides: {},
    timeseriesChart: {
      removeCloudy: true,
      showDots: true,
      smoothEnabled: false,
      smoothing: { window: 7, order: 3 },
    },
  });
});

describe('timeseries chart options', () => {
  it('patches one option without disturbing the others', () => {
    // The panel drops back to a spinner between tasks, unmounting the chart, so
    // these live here rather than in its own state - a toggle has to outlive it.
    usePrefsStore.getState().setTimeseriesChart({ showDots: false });
    usePrefsStore.getState().setTimeseriesChart({ smoothing: { window: 11, order: 2 } });

    expect(usePrefsStore.getState().timeseriesChart).toEqual({
      removeCloudy: true,
      showDots: false,
      smoothEnabled: false,
      smoothing: { window: 11, order: 2 },
    });
  });
});

describe('skip confirmation', () => {
  it('persists the user preference in the shared preference store', () => {
    usePrefsStore.getState().setSkipConfirmDisabled(true);
    expect(usePrefsStore.getState().skipConfirmDisabled).toBe(true);
  });
});

describe('setPinnedStart', () => {
  it('sets and clears a per-view pin', () => {
    usePrefsStore.getState().setPinnedStart(1, 10);
    expect(usePrefsStore.getState().pinnedStart).toEqual({ 1: 10 });
    usePrefsStore.getState().setPinnedStart(1, null);
    expect(usePrefsStore.getState().pinnedStart).toEqual({});
  });
});

describe('markTourSeen', () => {
  it('adds a tour id once, no duplicates', () => {
    usePrefsStore.getState().markTourSeen('welcome');
    usePrefsStore.getState().markTourSeen('welcome');
    expect(usePrefsStore.getState().toursSeen).toEqual(['welcome']);
  });
});

describe('label styles', () => {
  it('merges patches and resets cleanly', () => {
    usePrefsStore.getState().setLabelStyle(5, { fillColor: '#fff' });
    usePrefsStore.getState().setLabelStyle(5, { strokeWidth: 3 });
    expect(usePrefsStore.getState().labelStyles[5]).toEqual({ fillColor: '#fff', strokeWidth: 3 });
    usePrefsStore.getState().resetLabelStyle(5);
    expect(usePrefsStore.getState().labelStyles[5]).toBeUndefined();
  });
});

describe('legend overrides', () => {
  it('sets and resets', () => {
    usePrefsStore.getState().setLegendOverride(7, { colormap_name: 'viridis' });
    expect(usePrefsStore.getState().legendOverrides[7]).toEqual({ colormap_name: 'viridis' });
    usePrefsStore.getState().resetLegendOverride(7);
    expect(usePrefsStore.getState().legendOverrides[7]).toBeUndefined();
  });
});
