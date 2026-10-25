import { describe, expect, it } from 'vitest';
import type { CampaignCreate, PlanetScenesGenerationConfig } from '~/api/client';
import {
  emptySource,
  emptyVizParams,
  type ImageryGenerationSeries,
  type ImageryStepState,
} from '~/features/layers/imagery/types';
import { validateImageryStep, validateSettingsStep } from './campaignValidation';

const form = (bbox: Partial<Record<string, number>>): CampaignCreate =>
  ({
    name: 'c',
    settings: {
      labels: [{ name: 'a', geometry_type: 'polygon' }],
      bbox_west: -176.5,
      bbox_south: 65.3,
      bbox_east: -170,
      bbox_north: 67.7,
      ...bbox,
    },
  }) as unknown as CampaignCreate;

describe('the campaign area', () => {
  it('accepts an ordinary box', () => {
    expect(validateSettingsStep(form({})).isValid).toBe(true);
  });

  // The one that got through: west < east held, so only the range check catches
  // it, and without that the insert failed on the table's CHECK as a 500.
  it('rejects a longitude the map wrapped past the antimeridian', () => {
    const { errors, isValid } = validateSettingsStep(form({ bbox_west: -196.17 }));
    expect(isValid).toBe(false);
    expect(errors.bbox).toMatch(/between -180 and 180/);
  });

  it('rejects a latitude past the pole', () => {
    expect(validateSettingsStep(form({ bbox_north: 95 })).isValid).toBe(false);
  });

  it('explains that an area may not straddle 180', () => {
    const { errors } = validateSettingsStep(form({ bbox_west: 163.8, bbox_east: -176.5 }));
    expect(errors.bbox).toMatch(/antimeridian/);
  });

  it('still catches an inverted latitude range', () => {
    const { errors } = validateSettingsStep(form({ bbox_south: 70, bbox_north: 65 }));
    expect(errors.bbox).toMatch(/South latitude/);
  });
});

const sceneConfig: PlanetScenesGenerationConfig = {
  kind: 'planet_scenes',
  item_types: ['PSScene'],
  start_date: '2025-02-01',
  end_date: '2025-02-28',
  collection_period_interval: 1,
  collection_period_unit: 'months',
  slice_period_interval: 3,
  slice_period_unit: 'days',
  whole_window_cover: true,
  max_cloud_cover: 80,
  quality_categories: ['standard'],
};

const sourceWithoutUrls = (generationSeries: ImageryGenerationSeries[]): ImageryStepState => ({
  basemaps: [],
  sources: [
    {
      ...emptySource(),
      name: 'src',
      generationSeries,
      collections: [
        {
          id: 'col',
          name: 'Feb 2025',
          slices: [{ id: 'sl', name: 'Feb', startDate: '2025-02-01', endDate: '2025-02-03' }],
          coverSliceIndex: 0,
          hasDedicatedCover: false,
          generationSeriesId: 'series',
          data: { type: 'manual', vizUrls: [] },
        },
      ],
    },
  ],
});

const stacSource = (assets: string[]): ImageryStepState => ({
  basemaps: [],
  sources: [
    {
      ...emptySource(),
      name: 'S2',
      visualizations: [{ name: 'Viz 3' }],
      collections: [
        {
          id: 'col',
          name: '2024',
          slices: [{ id: 'sl', name: 'w1', startDate: '2024-01-01', endDate: '2024-01-07' }],
          coverSliceIndex: 0,
          hasDedicatedCover: false,
          data: {
            type: 'stac_browser',
            catalogUrl: 'https://stac.example',
            stacCollectionId: 'c',
            isMpc: false,
            visualizations: [{ name: 'Viz 3', vizParams: { ...emptyVizParams(), assets } }],
            vizUrls: [],
          },
        },
      ],
    },
  ],
});

describe('imagery that cannot be saved', () => {
  it('names the visualization that has no bands', () => {
    const { errors } = validateImageryStep(stacSource([]));
    expect(errors.source_0_col_0_viz_0_bands).toContain('"Viz 3"');
    expect(validateImageryStep(stacSource(['B04'])).isValid).toBe(true);
  });

  it('rejects slices without a name or with dates out of order', () => {
    const state = stacSource(['B04']);
    state.sources[0].collections[0].slices = [
      { id: 'a', name: ' ', startDate: '2024-01-01', endDate: '2024-01-07' },
      { id: 'b', name: 'b', startDate: '2024-02-01', endDate: '2024-01-07' },
    ];
    const { errors } = validateImageryStep(state);
    expect(errors.source_0_col_0_slice_names).toBeDefined();
    expect(errors.source_0_col_0_slice_dates).toBeDefined();
  });

  it('rejects a basemap whose URL is not http(s)', () => {
    const state = stacSource(['B04']);
    state.basemaps = [{ id: 'b', name: 'Mine', url: 'not a url at all' }];
    expect(validateImageryStep(state).errors.basemap_0_url).toContain('Mine');
  });
});

describe('imagery slice URLs', () => {
  it('are not asked of Planet scene slices, whose layers are minted later', () => {
    const state = sourceWithoutUrls([{ id: 'series', config: sceneConfig }]);
    expect(validateImageryStep(state).isValid).toBe(true);
  });

  it('are still required of a hand-authored source', () => {
    const { errors } = validateImageryStep(sourceWithoutUrls([]));
    expect(errors.source_0_col_0_vizurls).toMatch(/missing visualization URLs/);
  });
});
