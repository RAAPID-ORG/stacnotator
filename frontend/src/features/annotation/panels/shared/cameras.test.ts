import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraFor,
  DEFAULT_MAP_ZOOM,
  focusCameraTarget,
  loadCameraTarget,
  releaseCamera,
  type LoadCameraInput,
} from './cameras';

const CAMPAIGN_BBOX: [number, number, number, number] = [-10, -20, 10, 20];
const TASK: [number, number] = [4, 5];

function loadInput(over: Partial<LoadCameraInput> = {}): LoadCameraInput {
  return {
    mode: 'tasks',
    taskCenter: TASK,
    campaignBbox: CAMPAIGN_BBOX,
    workingZoom: 14,
    ...over,
  };
}

describe('loadCameraTarget', () => {
  it('frames the first task at the source working zoom in tasks mode', () => {
    expect(loadCameraTarget(loadInput())).toEqual({ kind: 'center', center: TASK, zoom: 14 });
  });

  it('frames the whole campaign in explore mode', () => {
    expect(loadCameraTarget(loadInput({ mode: 'explore' }))).toEqual({
      kind: 'fit',
      bbox: CAMPAIGN_BBOX,
    });
  });

  it('lets an explore deep link win over the campaign extent', () => {
    const target = loadCameraTarget(loadInput({ mode: 'explore', deepLinkCenter: [1, 2] }));
    expect(target).toEqual({ kind: 'center', center: [1, 2], zoom: 14 });
  });

  it('ignores a deep-link centre in tasks mode, where that link is never offered', () => {
    const target = loadCameraTarget(loadInput({ deepLinkCenter: [1, 2] }));
    expect(target).toEqual({ kind: 'center', center: TASK, zoom: 14 });
  });

  it('falls back to the default working zoom when no source declares one', () => {
    const target = loadCameraTarget(loadInput({ workingZoom: null }));
    expect(target).toEqual({ kind: 'center', center: TASK, zoom: DEFAULT_MAP_ZOOM });
  });

  it('leaves the camera alone when there is nothing to frame', () => {
    expect(loadCameraTarget(loadInput({ taskCenter: null }))).toBeNull();
    expect(loadCameraTarget(loadInput({ mode: 'explore', campaignBbox: null }))).toBeNull();
  });
});

describe('focusCameraTarget', () => {
  it('recentres tasks mode on the new task at the working zoom', () => {
    const target = focusCameraTarget({ mode: 'tasks', center: TASK, workingZoom: 16 });
    expect(target).toEqual({ kind: 'center', center: TASK, zoom: 16 });
  });

  it('never drives the camera from explore, where the focus does not move', () => {
    expect(focusCameraTarget({ mode: 'explore', center: TASK, workingZoom: 16 })).toBeNull();
  });

  it('does nothing without a focus', () => {
    expect(focusCameraTarget({ mode: 'tasks', center: null, workingZoom: 16 })).toBeNull();
  });
});

describe('window camera lifetime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the same camera when a window unmounts and remounts (popout and return)', () => {
    vi.useFakeTimers();
    const before = cameraFor(901);

    releaseCamera(901); // the panel leaves the canvas...
    const after = cameraFor(901); // ...and reappears on the other screen

    expect(after).toBe(before);
    vi.advanceTimersByTime(10);
    expect(cameraFor(901)).toBe(before); // the reclaim cancelled the release
  });

  it('still drops the camera of a collection that really did go away', () => {
    vi.useFakeTimers();
    const before = cameraFor(902);

    releaseCamera(902);
    vi.advanceTimersByTime(10);

    expect(cameraFor(902)).not.toBe(before);
  });
});
