import { beforeEach, describe, expect, it } from 'vitest';
import type { MapClickEvent } from '~/features/annotation/engine/map';
import { resetInteractionSpec, useInteractionSpec } from '../shared/interactionSpec';
import { taskProbeClick } from './MainMapPanel';

function click(over: Partial<MapClickEvent> = {}): MapClickEvent {
  return { lonLat: [7, 8], shiftKey: false, ...over };
}

beforeEach(() => {
  resetInteractionSpec();
});

// Tasks mode had no writer for the probe point at all, which left the
// timeseries panel's per-point probe unreachable outside Explore.
describe('taskProbeClick', () => {
  it('probes the clicked point', () => {
    taskProbeClick(click());
    expect(useInteractionSpec.getState().probePoint).toEqual([7, 8]);
  });

  it('moves the probe to the next click', () => {
    taskProbeClick(click());
    taskProbeClick(click({ lonLat: [1, 2] }));
    expect(useInteractionSpec.getState().probePoint).toEqual([1, 2]);
  });

  it('ignores a shift-click, which belongs to the box gestures', () => {
    taskProbeClick(click({ shiftKey: true }));
    expect(useInteractionSpec.getState().probePoint).toBeNull();
  });
});
