import { describe, it, expect } from 'vitest';
import type { RenderConfig } from '~/api/client';
import { applyRenderOverride, effectiveRenderConfig, isCustomized } from './customMapOverride';

const TILES = 'https://tiler.test/searches/s1/tiles/WebMercatorQuad/{z}/{x}/{y}.png';

const CONTINUOUS: RenderConfig = { mode: 'continuous', colormap_name: 'viridis', rescale: [0, 1] };
const CATEGORICAL: RenderConfig = {
  mode: 'categorical',
  entries: [
    { value: 1, color: '#ff0000', label: 'crop' },
    { value: 2, color: '#00ff00', label: 'other' },
  ],
};

const contUrl = `${TILES}?assets=data&asset_as_band=true&rescale=0%2C1&colormap_name=viridis`;
const catUrl = `${TILES}?assets=data&asset_as_band=true&colormap=%7B%221%22%3A%5B255%2C0%2C0%2C255%5D%7D`;

const query = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1));

describe('effectiveRenderConfig', () => {
  it('layers only the overridden keys on top', () => {
    const merged = effectiveRenderConfig(CONTINUOUS, { colormap_name: 'magma' });
    expect(merged).toEqual({ mode: 'continuous', colormap_name: 'magma', rescale: [0, 1] });
    expect(effectiveRenderConfig(CONTINUOUS, undefined)).toBe(CONTINUOUS);
  });
});

describe('isCustomized', () => {
  it('clears once the user picks the campaign colour back by hand', () => {
    expect(isCustomized(CONTINUOUS, { colormap_name: 'magma' })).toBe(true);
    expect(isCustomized(CONTINUOUS, { colormap_name: 'viridis' })).toBe(false);
    expect(isCustomized(CONTINUOUS, undefined)).toBe(false);
  });
});

describe('applyRenderOverride', () => {
  it('keeps the {z}/{x}/{y} placeholders unencoded', () => {
    const out = applyRenderOverride(contUrl, CONTINUOUS, { colormap_name: 'magma' });
    expect(out.startsWith(`${TILES}?`)).toBe(true);
    expect(out).not.toContain('%7B');
  });

  it('preserves the structural params the server built', () => {
    const out = applyRenderOverride(contUrl, CONTINUOUS, { colormap_name: 'magma' });
    expect(query(out).get('assets')).toBe('data');
    expect(query(out).get('asset_as_band')).toBe('true');
  });

  it('swaps colormap_name and rescale for a continuous map', () => {
    const out = applyRenderOverride(contUrl, CONTINUOUS, {
      colormap_name: 'magma',
      rescale: [0.2, 0.8],
    });
    expect(query(out).get('colormap_name')).toBe('magma');
    expect(query(out).get('rescale')).toBe('0.2,0.8');
    expect(query(out).get('colormap')).toBeNull();
  });

  it('encodes categorical colours the way the tiler expects', () => {
    const out = applyRenderOverride(catUrl, CATEGORICAL, {
      entries: [
        { value: 1, color: '#0000ff', label: 'crop' },
        { value: 2, color: '#00ff00', label: 'other' },
      ],
    });
    expect(JSON.parse(query(out).get('colormap') ?? '')).toEqual({
      '1': [0, 0, 255, 255],
      '2': [0, 255, 0, 255],
    });
    expect(query(out).get('colormap_name')).toBeNull();
    expect(query(out).get('rescale')).toBeNull();
  });

  it('honours an explicit alpha channel', () => {
    const out = applyRenderOverride(catUrl, CATEGORICAL, {
      entries: [{ value: 1, color: '#0000ff80', label: 'crop' }],
    });
    expect(JSON.parse(query(out).get('colormap') ?? '')).toEqual({ '1': [0, 0, 255, 128] });
  });

  it('falls back to the server URL when there is no override, or it cannot render', () => {
    expect(applyRenderOverride(contUrl, CONTINUOUS, undefined)).toBe(contUrl);
    expect(applyRenderOverride(catUrl, CATEGORICAL, { entries: [] })).toBe(catUrl);
    expect(
      applyRenderOverride(catUrl, CATEGORICAL, { entries: [{ value: 1, color: 'nonsense' }] })
    ).toBe(catUrl);
    const noColormap: RenderConfig = { mode: 'continuous', rescale: [0, 1] };
    expect(applyRenderOverride(contUrl, noColormap, { rescale: [0, 2] })).toBe(contUrl);
  });
});
