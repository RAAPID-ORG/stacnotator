import { describe, it, expect } from 'vitest';

/**
 * Tests for the pure helper logic extracted from useCustomMaps.
 *
 * The hook itself mixes React lifecycle with OL map mutations, making it
 * unsuitable for pure unit tests. These tests cover the tile URL builder,
 * which is the most logic-dense pure function in the hook.
 */

// Inline the pure `buildTileUrl` logic so it can be tested without React / OL
// (mirrors the implementation in useCustomMaps.ts)
const TILER_BASE = 'http://tiler:8001';

function buildTileUrl(mapId: string, vizParams: Record<string, unknown> | null): string {
  const base = `${TILER_BASE}/api/custom-map/${mapId}/tiles/{z}/{x}/{y}.png`;
  if (!vizParams) return base;

  const params = new URLSearchParams();
  const { assets, rescale, colormapName, colorFormula, nodata } = vizParams as Record<
    string,
    unknown
  >;

  if (Array.isArray(assets)) {
    for (const b of assets as string[]) params.append('bidx', b);
  }
  if (typeof rescale === 'string' && rescale) params.append('rescale', rescale);
  if (typeof colormapName === 'string' && colormapName)
    params.append('colormap_name', colormapName);
  if (typeof colorFormula === 'string' && colorFormula)
    params.append('color_formula', colorFormula);
  if (typeof nodata === 'number') params.append('nodata', String(nodata));

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

describe('buildTileUrl', () => {
  const ID = 'abc-uuid-123';
  const BASE = `http://tiler:8001/api/custom-map/${ID}/tiles/{z}/{x}/{y}.png`;

  it('returns bare template when viz_params is null', () => {
    expect(buildTileUrl(ID, null)).toBe(BASE);
  });

  it('appends bidx for each asset', () => {
    const url = buildTileUrl(ID, { assets: ['1', '2', '3'] });
    expect(url).toContain('bidx=1');
    expect(url).toContain('bidx=2');
    expect(url).toContain('bidx=3');
  });

  it('appends rescale', () => {
    const url = buildTileUrl(ID, { assets: ['1'], rescale: '0,255' });
    expect(url).toContain('rescale=0%2C255');
  });

  it('appends colormap_name', () => {
    const url = buildTileUrl(ID, { assets: ['1'], colormapName: 'viridis' });
    expect(url).toContain('colormap_name=viridis');
  });

  it('appends color_formula', () => {
    const url = buildTileUrl(ID, { assets: ['1'], colorFormula: 'Gamma RGB 1.5' });
    expect(url).toContain('color_formula=');
  });

  it('appends nodata', () => {
    const url = buildTileUrl(ID, { assets: ['1'], nodata: -9999 });
    expect(url).toContain('nodata=-9999');
  });

  it('omits empty string rescale', () => {
    const url = buildTileUrl(ID, { assets: ['1'], rescale: '' });
    expect(url).not.toContain('rescale');
  });

  it('omits nodata when not a number', () => {
    const url = buildTileUrl(ID, { assets: ['1'], nodata: null });
    expect(url).not.toContain('nodata');
  });

  it('returns bare base URL when params produce empty query string', () => {
    const url = buildTileUrl(ID, {});
    expect(url).toBe(BASE);
  });
});

// Pure logic tests for the visibility cycling logic
// (mirrors the 'c' key handler in MainAnnotationContainer)
function cycleCustomMapVisibility(
  readyIds: string[],
  currentVisible: Set<string>
): { show: string | null; hide: string[] } {
  const visibleIdx = readyIds.findIndex((id) => currentVisible.has(id));
  const nextIdx = (visibleIdx + 1) % (readyIds.length + 1);
  const hide = readyIds.filter((id) => currentVisible.has(id));
  const show = nextIdx < readyIds.length ? readyIds[nextIdx] : null;
  return { show, hide };
}

describe('cycleCustomMapVisibility', () => {
  it('shows first map when none are visible', () => {
    const { show, hide } = cycleCustomMapVisibility(['a', 'b', 'c'], new Set());
    expect(show).toBe('a');
    expect(hide).toEqual([]);
  });

  it('cycles from first to second', () => {
    const { show, hide } = cycleCustomMapVisibility(['a', 'b', 'c'], new Set(['a']));
    expect(show).toBe('b');
    expect(hide).toEqual(['a']);
  });

  it('cycles from last to all-hidden', () => {
    const { show, hide } = cycleCustomMapVisibility(['a', 'b'], new Set(['b']));
    expect(show).toBeNull();
    expect(hide).toEqual(['b']);
  });

  it('wraps from all-hidden back to first', () => {
    // After all-hidden state, next press shows first
    const { show, hide } = cycleCustomMapVisibility(['a', 'b'], new Set());
    expect(show).toBe('a');
    expect(hide).toEqual([]);
  });

  it('handles single map: toggle on/off', () => {
    const first = cycleCustomMapVisibility(['a'], new Set());
    expect(first.show).toBe('a');

    const second = cycleCustomMapVisibility(['a'], new Set(['a']));
    expect(second.show).toBeNull();
    expect(second.hide).toEqual(['a']);
  });
});
