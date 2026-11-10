import { describe, expect, it } from 'vitest';
import type { ImagerySourceOut } from '~/api/client';
import { imageryEditorState, mergedImagery, sourceFromRecipe, type RecipeWindow } from './recipe';

const s2 = { id: 'sentinel-2-l2a', title: 'Sentinel-2 Level-2A', has_cloud_cover: true };

const season = (year: number, cover: RecipeWindow['cover']): RecipeWindow => ({
  name: `${year}`,
  slices: [
    { start: `${year}-05-01`, end: `${year}-05-31`, name: 'May' },
    { start: `${year}-07-01`, end: `${year}-07-31`, name: 'Jul' },
  ],
  cover,
});

describe('sourceFromRecipe', () => {
  it('builds the windows as given, with preset visualizations and cloud sort', () => {
    const source = sourceFromRecipe(
      { collection: 'sentinel-2-l2a', windows: [season(2021, 1), season(2022, 1)] },
      s2
    );
    expect(source.name).toBe('Sentinel-2 L2A');
    expect(source.visualizations.map((v) => v.name)).toEqual([
      'True Color (RGB)',
      'False Color (Vegetation)',
    ]);
    expect(source.generation_series).toEqual([]);
    expect(source.collections.map((c) => c.name)).toEqual(['2021', '2022']);
    expect(source.collections[0].slices.map((s) => s.name)).toEqual(['May', 'Jul']);
    expect(source.collections[0].cover_slice_index).toBe(1);
  });

  it('puts a dedicated cover in front of the slices', () => {
    const [window] = sourceFromRecipe(
      {
        collection: 'sentinel-2-l2a',
        windows: [season(2021, { start: '2021-06-15', end: '2021-08-15' })],
      },
      s2
    ).collections;
    expect(window.cover_slice_index).toBe(0);
    expect(window.slices.map((s) => s.start_date)).toEqual([
      '2021-06-15',
      '2021-05-01',
      '2021-07-01',
    ]);
  });

  it('rejects what it cannot build', () => {
    const build =
      (windows: RecipeWindow[], collection = 'sentinel-2-l2a', viz?: string[]) =>
      () =>
        sourceFromRecipe({ collection, windows, visualizations: viz }, s2);
    expect(build([season(2021, 0)], 'modis')).toThrow(/Unknown collection/);
    expect(build([season(2021, 0)], 'sentinel-2-l2a', ['X'])).toThrow(/no visualization "X"/);
    expect(build([season(2021, 2)])).toThrow(/not a slice index/);
    expect(
      build([{ name: 'w', slices: [{ start: '2021-07-31', end: '2021-07-01' }], cover: 0 }])
    ).toThrow(/start <= end/);
    expect(build([])).toThrow(/at least one window/);
  });
});

describe('imageryEditorState', () => {
  it('defaults to every default basemap and filters by name', () => {
    expect(imageryEditorState([], []).basemaps).toHaveLength(3);
    expect(imageryEditorState([], [], ['OpenTopoMap']).basemaps.map((b) => b.name)).toEqual([
      'OpenTopoMap',
    ]);
    expect(() => imageryEditorState([], [], ['Nope'])).toThrow(/Unknown basemaps/);
  });
});

describe('mergedImagery', () => {
  const stored = (id: number, name: string): ImagerySourceOut => ({
    id,
    name,
    crosshair_hex6: 'ff0000',
    default_zoom: 15,
    display_order: id,
    visualizations: [{ id: id * 10, name: 'RGB', display_order: 0 }],
    collections: [],
  });
  const current = {
    sources: [stored(1, 'Planet'), stored(2, 'Sentinel-2 L2A'), stored(3, 'Old')],
    basemaps: [{ id: 5, name: 'OpenTopoMap', url: 'https://topo/{z}/{x}/{y}.png' }],
  };
  const recipe = { collection: 'sentinel-2-l2a', windows: [season(2024, 0)] };

  it('replaces a source by name in place, drops removed ones and keeps the rest', () => {
    const merged = mergedImagery(current, [recipe], [s2], { remove: ['Old'] });
    expect(merged.sources.map((s) => [s.id, s.name])).toEqual([
      [1, 'Planet'],
      [2, 'Sentinel-2 L2A'],
    ]);
    expect(merged.sources[0].visualizations).toEqual([{ id: 10, name: 'RGB' }]);
    expect(merged.sources[1].collections.map((c) => c.name)).toEqual(['2024']);
    expect(merged.basemaps.map((b) => [b.id, b.name])).toEqual([[5, 'OpenTopoMap']]);
  });

  it('adds a recipe with a new name and reuses stored basemaps by name', () => {
    const merged = mergedImagery(current, [{ ...recipe, name: 'S2 2024' }], [s2], {
      basemaps: ['OpenTopoMap'],
    });
    expect(merged.sources.map((s) => s.name)).toEqual([
      'Planet',
      'Sentinel-2 L2A',
      'Old',
      'S2 2024',
    ]);
    expect(merged.sources[3].id).toBeUndefined();
    expect(merged.basemaps.map((b) => b.id)).toEqual([5]);
    expect(() => mergedImagery(current, [], [], { remove: ['Nope'] })).toThrow(/No source/);
  });
});
