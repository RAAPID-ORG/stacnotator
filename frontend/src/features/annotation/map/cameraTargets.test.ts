import { DEFAULT_MAP_ZOOM } from '~/shared/map/Camera';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraFor,
  focusFirstViewSetup,
  focusCameraTarget,
  loadCameraTarget,
  mainCamera,
  releaseCamera,
} from './camera';

const CAMPAIGN_BBOX: [number, number, number, number] = [-10, -20, 10, 20];
const TASK: [number, number] = [4, 5];

function loadInput(
  over: Partial<Parameters<typeof loadCameraTarget>[0]> = {}
): Parameters<typeof loadCameraTarget>[0] {
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
    expect(loadCameraTarget(loadInput())).toEqual({ center: TASK, zoom: 14 });
  });

  it('opens Explore at the campaign centre and source working zoom', () => {
    expect(loadCameraTarget(loadInput({ mode: 'explore' }))).toEqual({ center: [0, 0], zoom: 14 });
  });

  it('uses zoom 15 for Explore when no source declares a working zoom', () => {
    expect(loadCameraTarget(loadInput({ mode: 'explore', workingZoom: null }))).toEqual({
      center: [0, 0],
      zoom: 15,
    });
  });

  it('lets an explore deep link win over the campaign extent', () => {
    const target = loadCameraTarget(loadInput({ mode: 'explore', deepLinkCenter: [1, 2] }));
    expect(target).toEqual({ center: [1, 2], zoom: 14 });
  });

  it('ignores a deep-link centre in tasks mode, where that link is never offered', () => {
    const target = loadCameraTarget(loadInput({ deepLinkCenter: [1, 2] }));
    expect(target).toEqual({ center: TASK, zoom: 14 });
  });

  it('falls back to the default working zoom when no source declares one', () => {
    const target = loadCameraTarget(loadInput({ workingZoom: null }));
    expect(target).toEqual({ center: TASK, zoom: DEFAULT_MAP_ZOOM });
  });

  it('leaves the camera alone when there is nothing to frame', () => {
    expect(loadCameraTarget(loadInput({ taskCenter: null }))).toBeNull();
    expect(loadCameraTarget(loadInput({ mode: 'explore', campaignBbox: null }))).toBeNull();
  });
});

describe('focusCameraTarget', () => {
  it('recentres tasks mode on the new task at the working zoom', () => {
    const target = focusCameraTarget({ mode: 'tasks', center: TASK, workingZoom: 16 });
    expect(target).toEqual({ center: TASK, zoom: 16 });
  });

  it('never drives the camera from explore, where the focus does not move', () => {
    expect(focusCameraTarget({ mode: 'explore', center: TASK, workingZoom: 16 })).toBeNull();
  });

  it('does nothing without a focus', () => {
    expect(focusCameraTarget({ mode: 'tasks', center: null, workingZoom: 16 })).toBeNull();
  });
});

describe('first-view setup', () => {
  it('keeps the campaign centre and enters at zoom 15', () => {
    mainCamera.moveTo({ center: [7, 8], zoom: 3 });

    focusFirstViewSetup(15);

    const state = mainCamera.getState();
    expect(state.center[0]).toBeCloseTo(7);
    expect(state.center[1]).toBeCloseTo(8);
    expect(state.zoom).toBe(15);
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
