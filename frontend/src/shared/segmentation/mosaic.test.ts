import { describe, expect, it } from 'vitest';
import { bboxToExtent, chooseZoom, cropRect, extentPixels, planMosaic } from './mosaic';
import { tileUrl } from '~/shared/imagery/tileUrls';

// About 1 km across, in Washington state.
const BBOX: [number, number, number, number] = [-117.6, 47.6, -117.588, 47.608];

describe('mosaic planning', () => {
  it('picks the sharpest zoom whose image stays under the pixel budget', () => {
    const extent = bboxToExtent(BBOX);
    const z = chooseZoom(extent, 18, 2048);
    expect(Math.max(...Object.values(extentPixels(extent, z)))).toBeLessThanOrEqual(2048);
    expect(Math.max(...Object.values(extentPixels(extent, z + 1)))).toBeGreaterThan(2048);
  });

  it('never goes past the native zoom', () => {
    expect(chooseZoom(bboxToExtent([-117.6, 47.6, -117.5999, 47.6001]), 14, 2048)).toBe(14);
  });

  it('crops the stitched tiles to exactly the extent', () => {
    const extent = bboxToExtent(BBOX);
    const plan = planMosaic(extent, 16);
    const rect = cropRect(plan, 256);
    const { width, height } = extentPixels(extent, 16);
    expect(rect.width).toBeCloseTo(width, 0);
    expect(rect.height).toBeCloseTo(height, 0);
    expect(rect.x + rect.width).toBeLessThanOrEqual((plan.x1 - plan.x0 + 1) * 256);
    expect(rect.y + rect.height).toBeLessThanOrEqual((plan.y1 - plan.y0 + 1) * 256);
  });

  it('fills every placeholder the map sources accept', () => {
    expect(tileUrl('https://t/{z}/{x}/{y}?q={q}&ty={-y}', 3, 5, 2)).toBe(
      'https://t/3/5/2?q=121&ty=5'
    );
  });
});
