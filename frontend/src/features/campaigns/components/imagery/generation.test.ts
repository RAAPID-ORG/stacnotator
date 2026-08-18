import { describe, expect, it } from 'vitest';
import { editableGenerationSeries, retainMatchingIds } from './generation';
import type {
  CollectionItem,
  ImageryGenerationConfig,
  ImageryGenerationSeries,
  ImagerySource,
} from './types';

const generationConfig = (title: string): ImageryGenerationConfig => ({
  version: 1,
  catalogUrl: 'https://example.test/stac',
  stacCollectionId: title.toLowerCase(),
  collectionTitle: title,
  isMpc: false,
  hasCloudCover: false,
  startDate: '2025-01',
  endDate: '2025-12',
  collectionPeriodInterval: 1,
  collectionPeriodUnit: 'months',
  slicePeriodInterval: 1,
  slicePeriodUnit: 'weeks',
  coverMode: 'nth',
  coverSliceNth: 1,
  maxCloudCover: 90,
  itemSort: 'date_desc',
  coverMaxCloudCover: 90,
  coverItemSort: 'date_desc',
  visualizations: [
    { name: 'RGB', vizParams: { assets: ['red'], assetAsBand: false, rescale: '' } },
  ],
  coverVisualizations: [],
});

const collection = (id: string, start: string, seriesId?: string): CollectionItem => ({
  id,
  name: start,
  coverSliceIndex: 0,
  hasDedicatedCover: false,
  generationSeriesId: seriesId,
  slices: [{ id: `slice-${id}`, name: '', startDate: start, endDate: start }],
  data: {
    type: 'stac_browser',
    catalogUrl: 'https://example.test/stac',
    stacCollectionId: 'sentinel',
    isMpc: false,
    mode: 'mosaic',
    visualizations: [
      { name: 'RGB', vizParams: { assets: ['red'], assetAsBand: false, rescale: '' } },
    ],
    vizUrls: [],
  },
});

const source = (
  collections: CollectionItem[],
  generationSeries: ImageryGenerationSeries[]
): ImagerySource => ({
  id: 'source',
  name: 'Source',
  crosshairHex6: 'ff0000',
  defaultZoom: 15,
  visualizations: [{ name: 'RGB' }],
  collections,
  generationSeries,
});

describe('imagery generation series', () => {
  it('returns every explicitly persisted series independently', () => {
    const series = editableGenerationSeries(
      source(
        [
          collection('a', '2025-01-01', 'series-a'),
          collection('b', '2025-02-01', 'series-a'),
          collection('c', '2024-01-01', 'series-b'),
          collection('manual', '2020-01-01'),
        ],
        [
          { id: 'series-a', config: generationConfig('Sentinel') },
          { id: 'series-b', config: generationConfig('Landsat') },
        ]
      )
    );

    expect(series.map((item) => item.id)).toEqual(['series-a', 'series-b']);
    expect(series[0].collections.map((item) => item.id)).toEqual(['a', 'b']);
    expect(series[1].collections.map((item) => item.id)).toEqual(['c']);
  });

  it('keeps configuration on the series instead of duplicating it on collections', () => {
    const config = generationConfig('Sentinel');
    const [series] = editableGenerationSeries(
      source([collection('a', '2025-01-01', 'series-a')], [{ id: 'series-a', config }])
    );

    expect(series.config.collectionTitle).toBe('Sentinel');
    expect('generationConfig' in series.collections[0]).toBe(false);
  });

  it('retains persisted ids for unchanged date windows', () => {
    const old = collection('42', '2025-01-01', 'series-a');
    const fresh = collection('new', '2025-01-01', 'series-a');
    const [merged] = retainMatchingIds([fresh], [old]);
    expect(merged.id).toBe('42');
    expect(merged.slices[0].id).toBe('slice-42');
  });

  it('does not infer provenance for unassociated historical collections', () => {
    expect(editableGenerationSeries(source([collection('old', '2025-01-01')], []))).toEqual([]);
  });
});
