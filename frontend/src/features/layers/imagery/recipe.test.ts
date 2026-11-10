import { describe, expect, it } from 'vitest';
import type { ImagerySourceOut } from '~/api/client';
import { mergedImagery, type ImageryRecipe, type RecipeWindow } from './recipe';

const s2 = { id: 'sentinel-2-l2a', title: 'Sentinel-2 Level-2A', has_cloud_cover: true };

const season = (year: number, cover: RecipeWindow['cover']): RecipeWindow => ({
  name: `${year}`,
  slices: [
    { start: `${year}-05-01`, end: `${year}-05-31`, name: 'May' },
    { start: `${year}-07-01`, end: `${year}-07-31`, name: 'Jul' },
  ],
  cover,
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
  const create = (recipes: ImageryRecipe[], basemaps = ['OpenTopoMap']) =>
    mergedImagery({ sources: [], basemaps: [] }, recipes, [s2], { basemaps });

  it('builds the windows as given, with preset visualizations and a dedicated cover first', () => {
    const { sources, basemaps } = create([
      {
        collection: 'sentinel-2-l2a',
        windows: [season(2021, 1), season(2022, { start: '2022-06-15', end: '2022-08-15' })],
      },
    ]);
    const [source] = sources;
    expect(source.name).toBe('Sentinel-2 L2A');
    expect(source.visualizations.map((v) => v.name)).toEqual([
      'True Color (RGB)',
      'False Color (Vegetation)',
    ]);
    expect(source.collections.map((c) => [c.name, c.cover_slice_index])).toEqual([
      ['2021', 1],
      ['2022', 0],
    ]);
    expect(source.collections[1].slices.map((s) => s.start_date)).toEqual([
      '2022-06-15',
      '2022-05-01',
      '2022-07-01',
    ]);
    expect(basemaps.map((b) => b.name)).toEqual(['OpenTopoMap']);
  });

  it('rejects what it cannot build', () => {
    const build =
      (windows: RecipeWindow[], collection = 'sentinel-2-l2a', viz?: string[]) =>
      () =>
        create([{ collection, windows, visualizations: viz }]);
    expect(build([season(2021, 0)], 'modis')).toThrow(/Unknown collection/);
    expect(build([season(2021, 0)], 'sentinel-2-l2a', ['X'])).toThrow(/no visualization "X"/);
    expect(build([season(2021, 2)])).toThrow(/not a slice index/);
    expect(
      build([{ name: 'w', slices: [{ start: '2021-07-31', end: '2021-07-01' }], cover: 0 }])
    ).toThrow(/start <= end/);
    expect(build([])).toThrow(/at least one window/);
    expect(() => create([], ['Nope'])).toThrow(/Unknown basemaps/);
    expect(() => mergedImagery(current, [], [], { remove: ['Nope'] })).toThrow(/No source/);
  });

  it('replaces a source by name in place, adds new names, drops removed ones', () => {
    const merged = mergedImagery(current, [recipe, { ...recipe, name: 'S2 2024' }], [s2], {
      remove: ['Old'],
      basemaps: ['OpenTopoMap'],
    });
    expect(merged.sources.map((s) => [s.id, s.name])).toEqual([
      [1, 'Planet'],
      [2, 'Sentinel-2 L2A'],
      [undefined, 'S2 2024'],
    ]);
    expect(merged.sources[0].visualizations).toEqual([{ id: 10, name: 'RGB' }]);
    expect(merged.sources[1].collections.map((c) => c.name)).toEqual(['2024']);
    expect(merged.basemaps.map((b) => [b.id, b.name])).toEqual([[5, 'OpenTopoMap']]);
  });

  it('keeps the ids of unchanged windows and slices and the display settings it replaces', () => {
    const slice = (id: number, start: string, end: string) => ({
      id,
      name: start,
      start_date: start,
      end_date: end,
      display_order: 0,
      tiles: [],
    });
    const source: ImagerySourceOut = {
      ...stored(2, 'Sentinel-2 L2A'),
      crosshair_hex6: '00ff00',
      collections: [
        {
          id: 100,
          name: '2024',
          cover_slice_index: 0,
          has_dedicated_cover: false,
          display_order: 0,
          visualizations: [],
          slices: [slice(101, '2024-05-01', '2024-05-31'), slice(102, '2024-07-01', '2024-07-31')],
        },
      ],
    };
    const [merged] = mergedImagery(
      { sources: [source], basemaps: [] },
      [{ ...recipe, windows: [season(2024, 0), season(2025, 0)] }],
      [s2]
    ).sources;
    expect(merged.crosshair_hex6).toBe('00ff00');
    expect(merged.collections.map((c) => [c.id, c.slices.map((s) => s.id)])).toEqual([
      [100, [101, 102]],
      [undefined, [undefined, undefined]],
    ]);
  });
});
