import { describe, expect, it } from 'vitest';
import { sourceToBackend } from './draftSync';
import type { ImageryGenerationConfig, ImagerySource } from './types';

const config: ImageryGenerationConfig = {
  version: 1,
  catalogUrl: 'https://example.test/stac',
  stacCollectionId: 'sentinel',
  collectionTitle: 'Sentinel',
  isMpc: false,
  hasCloudCover: true,
  startDate: '2025-01',
  endDate: '2025-12',
  collectionPeriodInterval: 1,
  collectionPeriodUnit: 'months',
  slicePeriodInterval: 1,
  slicePeriodUnit: 'weeks',
  coverMode: 'nth',
  coverSliceNth: 1,
  maxCloudCover: 80,
  itemSort: 'date_desc',
  coverMaxCloudCover: 70,
  coverItemSort: 'cloud_cover_asc',
  visualizations: [
    { name: 'RGB', vizParams: { assets: ['red'], assetAsBand: false, rescale: '' } },
  ],
  coverVisualizations: [],
};

describe('generation-series persistence payload', () => {
  it('writes configuration once at source level and collection references by key', () => {
    const source: ImagerySource = {
      id: '7',
      name: 'Source',
      crosshairHex6: 'ff0000',
      defaultZoom: 15,
      visualizations: [{ name: 'RGB' }],
      generationSeries: [{ id: '12', config }],
      collections: [
        {
          id: '42',
          name: 'January',
          generationSeriesId: '12',
          coverSliceIndex: 0,
          hasDedicatedCover: false,
          slices: [{ id: '100', name: '', startDate: '2025-01-01', endDate: '2025-01-31' }],
          data: {
            type: 'stac_browser',
            catalogUrl: config.catalogUrl,
            stacCollectionId: config.stacCollectionId,
            isMpc: false,
            mode: 'mosaic',
            visualizations: config.visualizations,
            vizUrls: [],
          },
        },
      ],
    };

    const payload = sourceToBackend(source);

    expect(payload.generation_series).toHaveLength(1);
    expect(payload.generation_series?.[0]).toMatchObject({
      key: '12',
      id: 12,
      config: { version: 1, collection_title: 'Sentinel' },
    });
    expect(payload.collections[0].generation_series_key).toBe('12');
    expect(payload.collections[0]).not.toHaveProperty('generation_config');
  });
});
