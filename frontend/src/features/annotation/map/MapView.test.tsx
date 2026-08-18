import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import OLMap from 'ol/Map';
import { Camera } from './camera';
import { MapView } from './MapView';

// jsdom has neither of these; OL constructs a ResizeObserver per map and asks
// the canvas for a 2d context while rendering. Neither is what this test is
// about - it only needs a real ol/Map to be constructible and disposable.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext ??= (() => null) as never;
});

describe('MapView teardown', () => {
  it('hands the map a throwaway view so an unmounted map stops following the camera', () => {
    const camera = new Camera({ center: [0, 0], zoom: 2 });
    const setView = vi.spyOn(OLMap.prototype, 'setView');

    const { unmount } = render(<MapView camera={camera} layers={[]} />);
    setView.mockClear();
    unmount();

    expect(setView).toHaveBeenCalledTimes(1);
    expect(setView.mock.calls[0][0]).not.toBe(camera.getView());
    setView.mockRestore();
  });
});
