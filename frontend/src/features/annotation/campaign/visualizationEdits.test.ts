import { describe, expect, it } from 'vitest';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTile,
  makeViz,
} from '../testing/fixtures';
import { buildImageryCatalog } from './imagery';
import { ownCopy, withVisualizationEdits, type VisualizationEdits } from './visualizationEdits';

const HOSTED = 'https://tiler.test/searches/abc/tiles/WebMercatorQuad/{z}/{x}/{y}.png';
const MPC =
  'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/m1/tiles/WebMercatorQuad/{z}/{x}/{y}';
const rgb = { assets: ['B04', 'B03', 'B02'], rescale: '0,3000', compositing: 'median' };

const campaign = makeCampaign({
  imagery_sources: [
    makeSource({
      id: 1,
      visualizations: [makeViz({ id: 10 })],
      collections: [
        makeCollection({
          id: 100,
          has_dedicated_cover: true,
          cover_slice_index: 0,
          search: { catalog_url: 'https://stac.test', stac_collection_id: 's2' },
          visualizations: [
            {
              visualization_id: 10,
              params: rgb,
              cover_params: { assets: ['visual'], rescale: '0,255' },
            },
          ],
          slices: [
            makeSlice({ id: 1, tiles: [makeTile({ visualization_id: 10, url: `${HOSTED}?x=1` })] }),
            makeSlice({
              id: 2,
              tiles: [
                makeTile({
                  visualization_id: 10,
                  url: `${MPC}?collection=sentinel-2-l2a&pixel_selection=first&assets=B04`,
                  tiler: 'mpc',
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
});

const edited = (edits: VisualizationEdits) =>
  withVisualizationEdits(buildImageryCatalog(campaign), campaign, edits);

const urlOf = (cat: ReturnType<typeof edited>, sliceId: number, vizId: number) =>
  cat.slices.get(sliceId)!.tiles.find((tile) => tile.visualization_id === vizId)!.url;

describe('a visualization the viewer redrew', () => {
  it('draws each slice with the URL the server would derive from the edited parameters', () => {
    const cat = edited({
      10: { patch: { color_formula: 'gamma RGB 1.5 saturation 1.2', rescale: '0,1500' } },
    });

    // Matches build_tile_url for the same parameters (backend/src/tilers/providers.py).
    expect(urlOf(cat, 2, 10)).toBe(
      `${MPC}?collection=sentinel-2-l2a&pixel_selection=first&assets=B04&assets=B03&assets=B02` +
        '&rescale=0%2C1500&rescale=0%2C1500&rescale=0%2C1500' +
        '&color_formula=gamma+RGB+1.5+saturation+1.2'
    );
    expect(urlOf(cat, 1, 10)).toBe(
      `${HOSTED}?assets=visual&rescale=0%2C1500&color_formula=gamma+RGB+1.5+saturation+1.2`
    );
  });

  it('keeps the server URL where the edit would leave nothing to draw', () => {
    const cat = edited({ 10: { patch: { assets: [] } } });
    expect(urlOf(cat, 1, 10)).toBe(`${HOSTED}?x=1`);
  });

  it('is drawn as the server sent it again once the edit is taken back', () => {
    const once = edited({ 10: { patch: { rescale: '0,1' } } });
    const back = withVisualizationEdits(once, campaign, {});
    expect(urlOf(back, 1, 10)).toBe(`${HOSTED}?x=1`);
  });
});

describe('a visualization the viewer added', () => {
  it('is offered by the source and drawn from its base with the edit applied', () => {
    const cat = edited({
      [-5]: { patch: { expression: 'B08' }, copy: { sourceId: 1, baseId: 10, name: 'NDVI' } },
    });

    expect(cat.sources.get(1)!.visualizations.map((viz) => viz.name)).toEqual([
      'True Color',
      'NDVI',
    ]);
    expect(cat.vizzes.get(-5)?.name).toBe('NDVI');
    expect(urlOf(cat, 2, -5)).toContain('expression=B08');
    expect(urlOf(cat, 2, 10)).toBe(
      `${MPC}?collection=sentinel-2-l2a&pixel_selection=first&assets=B04`
    );
  });

  it('copied from one of your own keeps its saved base and edit, under a free name', () => {
    const edits: VisualizationEdits = {
      [-5]: { patch: { expression: 'B08' }, copy: { sourceId: 1, baseId: 10, name: 'Mine' } },
    };
    const source = edited(edits).sources.get(1)!;

    expect(ownCopy(source, edits, -5, 'Mine')).toEqual({
      patch: { expression: 'B08' },
      copy: { sourceId: 1, baseId: 10, name: 'Mine 2' },
    });
  });
});
