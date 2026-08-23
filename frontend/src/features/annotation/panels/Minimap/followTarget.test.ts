import { describe, expect, it } from 'vitest';
import type { Bbox } from '~/shared/map/types';
import {
  MINIMAP_PADDING_FACTOR,
  TASK_OVERVIEW_ZOOM,
  exploreRefitTarget,
  needsRefit,
  paddedBounds,
  tasksModeTarget,
} from './followTarget';

describe('tasksModeTarget', () => {
  it('centres on the main camera at the fixed overview zoom', () => {
    expect(tasksModeTarget([10, 20])).toEqual({ center: [10, 20], zoom: TASK_OVERVIEW_ZOOM });
  });
});

describe('paddedBounds', () => {
  it('extends each side by the padding factor times the viewport span', () => {
    const bounds: Bbox = [0, 0, 10, 20]; // 10 wide, 20 tall
    const padded = paddedBounds(bounds, 1.5);
    expect(padded).toEqual([-15, -30, 25, 50]);
  });

  it('defaults to the module padding factor', () => {
    const bounds: Bbox = [0, 0, 4, 4];
    expect(paddedBounds(bounds)).toEqual(paddedBounds(bounds, MINIMAP_PADDING_FACTOR));
  });
});

describe('needsRefit', () => {
  it('is false when the viewport sits comfortably inside the minimap', () => {
    const minimap: Bbox = [-10, -10, 10, 10]; // 20x20 = 400
    const viewport: Bbox = [-4, -4, 4, 4]; // 8x8 = 64; ratio 0.16, above the 0.02 floor
    expect(needsRefit(minimap, viewport)).toBe(false);
  });

  it('is true when the viewport is not fully contained', () => {
    const minimap: Bbox = [-10, -10, 10, 10];
    const viewport: Bbox = [5, 5, 15, 15];
    expect(needsRefit(minimap, viewport)).toBe(true);
  });

  it('is true when the viewport has shrunk below the minimum area ratio', () => {
    const minimap: Bbox = [-10, -10, 10, 10];
    const tinyViewport: Bbox = [-0.5, -0.5, 0.5, 0.5]; // 1/400 = 0.0025
    expect(needsRefit(minimap, tinyViewport)).toBe(true);
  });

  it('is true against a degenerate (zero-area) minimap', () => {
    expect(needsRefit([0, 0, 0, 0], [-1, -1, 1, 1])).toBe(true);
  });
});

describe('exploreRefitTarget', () => {
  it('returns null (no refit) when the viewport is already well shown', () => {
    const minimap: Bbox = [-10, -10, 10, 10];
    const viewport: Bbox = [-4, -4, 4, 4];
    expect(exploreRefitTarget(minimap, viewport, false)).toBeNull();
  });

  it('returns a padded fit of the viewport when a refit is needed', () => {
    const minimap: Bbox = [-1, -1, 1, 1];
    const viewport: Bbox = [-5, -5, 5, 5];
    expect(exploreRefitTarget(minimap, viewport, false)).toEqual(paddedBounds(viewport));
  });

  it('keeps the ROI overview when the viewport is a sliver inside it', () => {
    const roi: Bbox = [-10, -10, 10, 10];
    const tinyViewport: Bbox = [-0.5, -0.5, 0.5, 0.5];
    expect(exploreRefitTarget(roi, tinyViewport, true)).toBeNull();
    expect(exploreRefitTarget(roi, tinyViewport, false)).toEqual(paddedBounds(tinyViewport));
  });

  it('leaves the ROI overview once the viewport moves outside it', () => {
    const roi: Bbox = [-10, -10, 10, 10];
    const viewport: Bbox = [12, 12, 14, 14];
    expect(exploreRefitTarget(roi, viewport, true)).toEqual(paddedBounds(viewport));
  });
});
