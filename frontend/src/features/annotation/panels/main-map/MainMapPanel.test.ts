import { beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '~/features/annotation/core/catalog';
import { makeCampaign } from '~/features/annotation/core/catalog/testHelpers';
import type { MapClickEvent } from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../../composition';
import { resetInteractionSpec, useInteractionSpec } from '../../shared/interactionSpec';
import {
  getActiveTool,
  resetToolState,
  selectTool,
  toggleTimeseriesTool,
} from '../../shared/toolState';
import { taskProbeClick } from './MainMapPanel';

const CAMPAIGN = makeCampaign({ id: 42 });

const CTX: ComposeCtx = {
  campaign: CAMPAIGN,
  catalog: buildCatalog(CAMPAIGN),
  view: null,
  mode: 'tasks',
  isMobile: false,
};

function click(over: Partial<MapClickEvent> = {}): MapClickEvent {
  return { lonLat: [7, 8], shiftKey: false, ...over };
}

beforeEach(() => {
  resetInteractionSpec();
  resetToolState();
});

describe('taskProbeClick', () => {
  it('probes the clicked point once the probe tool is armed', async () => {
    await selectTool('timeseries', CTX);
    taskProbeClick(click(), CTX);
    expect(useInteractionSpec.getState().probePoint).toEqual([7, 8]);
    expect(getActiveTool()).toBe('pan');
  });

  it('requires re-arming before another point can replace the probe', async () => {
    await selectTool('timeseries', CTX);
    taskProbeClick(click(), CTX);
    taskProbeClick(click({ lonLat: [1, 2] }), CTX);
    expect(useInteractionSpec.getState().probePoint).toEqual([7, 8]);

    await selectTool('timeseries', CTX);
    taskProbeClick(click({ lonLat: [1, 2] }), CTX);
    expect(useInteractionSpec.getState().probePoint).toEqual([1, 2]);
  });

  // The whole point of the tool: panning and inspecting a task must not keep
  // moving the marker and refetching the series.
  it('ignores a click while the probe tool is not armed', () => {
    taskProbeClick(click(), CTX);
    expect(useInteractionSpec.getState().probePoint).toBeNull();
  });

  it('ignores a shift-click, which belongs to the box gestures', async () => {
    await selectTool('timeseries', CTX);
    taskProbeClick(click({ shiftKey: true }), CTX);
    expect(useInteractionSpec.getState().probePoint).toBeNull();
  });
});

describe('toggleTimeseriesTool', () => {
  it('disarms the tool on a second press before a point is picked', () => {
    toggleTimeseriesTool(CTX);
    expect(getActiveTool()).toBe('timeseries');

    toggleTimeseriesTool(CTX);
    expect(getActiveTool()).toBe('pan');
    expect(useInteractionSpec.getState().probePoint).toBeNull();
    taskProbeClick(click({ lonLat: [1, 2] }), CTX);
    expect(useInteractionSpec.getState().probePoint).toBeNull();
  });
});
