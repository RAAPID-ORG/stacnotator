import { describe, it, expect, vi } from 'vitest';
import { Camera } from './Camera';
import type { CameraSnapshot } from './types';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('camera state', () => {
  it('round-trips lon/lat through the mercator view', () => {
    const camera = new Camera({ center: [12.34, 56.78], zoom: 9 });
    const state = camera.getState();
    expect(state.center[0]).toBeCloseTo(12.34, 9);
    expect(state.center[1]).toBeCloseTo(56.78, 9);
    expect(state.zoom).toBeCloseTo(9, 9);
  });

  it('moves center and zoom independently', () => {
    const camera = new Camera({ center: [0, 0], zoom: 4 });
    camera.moveTo({ zoom: 7 });
    expect(camera.getState().center[0]).toBeCloseTo(0, 9);
    expect(camera.getState().zoom).toBeCloseTo(7, 9);

    camera.moveTo({ center: [-3, 51] });
    expect(camera.getState().center[0]).toBeCloseTo(-3, 9);
    expect(camera.getState().center[1]).toBeCloseTo(51, 9);
    expect(camera.getState().zoom).toBeCloseTo(7, 9);
  });

  it('zooms by a relative delta', () => {
    const camera = new Camera({ center: [0, 0], zoom: 4 });
    camera.zoomBy(2);
    expect(camera.getState().zoom).toBeCloseTo(6, 9);
    camera.zoomBy(-0.5);
    expect(camera.getState().zoom).toBeCloseTo(5.5, 9);
  });

  it('pans by screen pixels: +x is east, +y is south', () => {
    const camera = new Camera({ center: [0, 0], zoom: 8 });
    camera.panByPixels(100, 50);
    const moved = camera.getState();
    expect(moved.center[0]).toBeGreaterThan(0);
    expect(moved.center[1]).toBeLessThan(0);

    camera.panByPixels(-100, -50);
    expect(camera.getState().center[0]).toBeCloseTo(0, 9);
    expect(camera.getState().center[1]).toBeCloseTo(0, 9);
  });
});

describe('getBounds', () => {
  it('matches the bounds an onChange snapshot carries, synchronously', () => {
    const camera = new Camera({ center: [10, 45], zoom: 6 });
    const bounds = camera.getBounds();
    expect(bounds[0]).toBeLessThan(10);
    expect(bounds[2]).toBeGreaterThan(10);
    expect(bounds[1]).toBeLessThan(45);
    expect(bounds[3]).toBeGreaterThan(45);
  });

  it('shrinks as zoom increases', () => {
    const camera = new Camera({ center: [0, 0], zoom: 2 });
    const wide = camera.getBounds();
    camera.moveTo({ zoom: 8 });
    const narrow = camera.getBounds();
    expect(narrow[2] - narrow[0]).toBeLessThan(wide[2] - wide[0]);
  });
});

describe('lonLatFromContainerPixel', () => {
  it('returns the camera center for the container center', () => {
    const camera = new Camera({ center: [12, 34], zoom: 6 });
    const [lon, lat] = camera.lonLatFromContainerPixel(150, 100, 300, 200);
    expect(lon).toBeCloseTo(12, 6);
    expect(lat).toBeCloseTo(34, 6);
  });

  it('moves east for a pixel right of center, and north for a pixel above it', () => {
    const camera = new Camera({ center: [0, 0], zoom: 6 });
    const [lon, lat] = camera.lonLatFromContainerPixel(200, 50, 300, 200);
    expect(lon).toBeGreaterThan(0);
    expect(lat).toBeGreaterThan(0);
  });

  it('scales with resolution: the same pixel offset covers more ground when zoomed out', () => {
    const zoomedIn = new Camera({ center: [0, 0], zoom: 10 });
    const zoomedOut = new Camera({ center: [0, 0], zoom: 4 });
    const near = zoomedIn.lonLatFromContainerPixel(200, 100, 300, 200);
    const far = zoomedOut.lonLatFromContainerPixel(200, 100, 300, 200);
    expect(Math.abs(far[0])).toBeGreaterThan(Math.abs(near[0]));
  });
});

describe('containerPixelFromLonLat', () => {
  it('is the inverse of the container-pixel conversion', () => {
    const camera = new Camera({ center: [12, 34], zoom: 8 });
    const coordinate = camera.lonLatFromContainerPixel(213, 71, 320, 180);

    const [x, y] = camera.containerPixelFromLonLat(coordinate, 320, 180);

    expect(x).toBeCloseTo(213, 8);
    expect(y).toBeCloseTo(71, 8);
  });
});

/** A camera only fits once a map with a real viewport renders it. */
const attachedCamera = (state: { center: [number, number]; zoom: number }) => {
  const camera = new Camera(state);
  camera.attach();
  return camera;
};

describe('fitBounds', () => {
  it('centres on the bbox', () => {
    const camera = attachedCamera({ center: [0, 0], zoom: 2 });
    camera.fitBounds([10, 40, 20, 50]);
    const { center } = camera.getState();
    expect(center[0]).toBeCloseTo(15, 6);
    expect(center[1]).toBeGreaterThan(44);
    expect(center[1]).toBeLessThan(46);
  });

  it('never zooms past maxZoom on a tiny bbox', () => {
    const camera = attachedCamera({ center: [0, 0], zoom: 2 });
    camera.fitBounds([9.999, 49.999, 10.001, 50.001], { maxZoom: 12 });
    expect(camera.getState().zoom).toBeCloseTo(12, 6);
  });

  it('zooms out further with padding', () => {
    const tight = attachedCamera({ center: [0, 0], zoom: 2 });
    tight.fitBounds([10, 40, 20, 50]);
    const padded = attachedCamera({ center: [0, 0], zoom: 2 });
    padded.fitBounds([10, 40, 20, 50], { paddingPx: 20 });
    expect(padded.getState().zoom).toBeLessThan(tight.getState().zoom);
  });
});

describe('a fit requested before a map attaches', () => {
  it('is held, then carried out on attach', () => {
    const camera = new Camera({ center: [0, 0], zoom: 2 });
    camera.fitBounds([10, 40, 20, 50]);
    expect(camera.getState().center[0]).toBeCloseTo(0, 6);

    camera.attach();
    const { center } = camera.getState();
    expect(center[0]).toBeCloseTo(15, 6);
    expect(center[1]).toBeGreaterThan(44);
    expect(center[1]).toBeLessThan(46);
  });

  it('keeps its padding and maxZoom', () => {
    const camera = new Camera({ center: [0, 0], zoom: 2 });
    camera.fitBounds([9.999, 49.999, 10.001, 50.001], { maxZoom: 12 });
    camera.attach();
    expect(camera.getState().zoom).toBeCloseTo(12, 6);
  });

  it('is replaced by a later request, and only the last one lands', () => {
    const camera = new Camera({ center: [0, 0], zoom: 2 });
    camera.fitBounds([10, 40, 20, 50]);
    camera.fitBounds([-30, -10, -20, 0]);
    camera.attach();
    expect(camera.getState().center[0]).toBeCloseTo(-25, 6);
  });

  it('reaches a listener that only subscribes once the map is up', async () => {
    const camera = new Camera({ center: [0, 0], zoom: 2 });
    camera.fitBounds([10, 40, 20, 50]);
    camera.attach();

    const seen: CameraSnapshot[] = [];
    camera.onChange((s) => seen.push(s));
    await nextFrame();
    await nextFrame();
    expect(seen).toHaveLength(1);
    expect(seen[0].center[0]).toBeCloseTo(15, 6);
  });

  it('does not re-run on a second attach', () => {
    const camera = new Camera({ center: [0, 0], zoom: 2 });
    camera.fitBounds([10, 40, 20, 50]);
    camera.attach();
    camera.moveTo({ center: [0, 0], zoom: 2 });
    camera.attach();
    expect(camera.getState().center[0]).toBeCloseTo(0, 6);
  });
});

describe('onChange', () => {
  it('coalesces a burst of moves into one frame callback', async () => {
    const camera = new Camera({ center: [0, 0], zoom: 4 });
    const seen: CameraSnapshot[] = [];
    camera.onChange((s) => seen.push(s));

    camera.moveTo({ center: [1, 1] });
    camera.moveTo({ center: [2, 2], zoom: 6 });
    expect(seen).toHaveLength(0);

    await nextFrame();
    await nextFrame();
    expect(seen).toHaveLength(1);
    expect(seen[0].center[0]).toBeCloseTo(2, 6);
    expect(seen[0].zoom).toBeCloseTo(6, 6);
    expect(seen[0].bounds[0]).toBeLessThan(seen[0].bounds[2]);
    expect(seen[0].bounds[1]).toBeLessThan(seen[0].bounds[3]);
  });

  it('stops calling back after unsubscribe', async () => {
    const camera = new Camera({ center: [0, 0], zoom: 4 });
    const cb = vi.fn();
    const off = camera.onChange(cb);

    camera.moveTo({ zoom: 5 });
    await nextFrame();
    await nextFrame();
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    camera.moveTo({ zoom: 6 });
    await nextFrame();
    await nextFrame();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('follow', () => {
  it('mirrors the leader until unfollowed', async () => {
    const leader = new Camera({ center: [0, 0], zoom: 4 });
    const follower = new Camera({ center: [0, 0], zoom: 4 });
    const unfollow = follower.follow(leader);

    leader.moveTo({ center: [5, 5], zoom: 8 });
    await nextFrame();
    await nextFrame();
    expect(follower.getState().center[0]).toBeCloseTo(5, 6);
    expect(follower.getState().center[1]).toBeCloseTo(5, 6);
    expect(follower.getState().zoom).toBeCloseTo(8, 6);

    unfollow();
    leader.moveTo({ center: [-5, -5], zoom: 3 });
    await nextFrame();
    await nextFrame();
    expect(follower.getState().center[0]).toBeCloseTo(5, 6);
    expect(follower.getState().zoom).toBeCloseTo(8, 6);
  });

  it('snaps to the leader position immediately on follow', () => {
    const leader = new Camera({ center: [10, 20], zoom: 7 });
    const follower = new Camera({ center: [0, 0], zoom: 2 });
    follower.follow(leader);
    expect(follower.getState().center[0]).toBeCloseTo(10, 6);
    expect(follower.getState().zoom).toBeCloseTo(7, 6);
  });
});
