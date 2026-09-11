import { describe, expect, it } from 'vitest';
import type { CampaignCreate, PlanetScenesGenerationConfigV1 } from '~/api/client';
import {
  emptySource,
  type ImageryGenerationSeries,
  type ImageryStepState,
} from '~/features/campaigns/components/imagery/types';
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

const sceneConfig: PlanetScenesGenerationConfigV1 = {
  kind: 'planet_scenes',
  version: 1,
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
          slices: [{ id: 'sl', name: '', startDate: '2025-02-01', endDate: '2025-02-03' }],
          coverSliceIndex: 0,
          hasDedicatedCover: false,
          generationSeriesId: 'series',
          data: { type: 'manual', vizUrls: [] },
        },
      ],
    },
  ],
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
