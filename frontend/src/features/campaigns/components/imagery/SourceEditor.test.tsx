import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImageryController } from './controller';
import { SourceEditor } from './SourceEditor';
import type { ImageryGenerationConfig, ImagerySource } from './types';

const config = (title: string): ImageryGenerationConfig => ({
  version: 1,
  catalogUrl: 'https://example.test/stac',
  stacCollectionId: title,
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

const source: ImagerySource = {
  id: 'source',
  name: 'Source',
  crosshairHex6: 'ff0000',
  defaultZoom: 15,
  visualizations: [{ name: 'RGB' }],
  generationSeries: [
    { id: 'sentinel-series', config: config('Sentinel') },
    { id: 'landsat-series', config: config('Landsat') },
  ],
  collections: [
    {
      id: 'sentinel-window',
      name: 'Sentinel window',
      generationSeriesId: 'sentinel-series',
      coverSliceIndex: 0,
      hasDedicatedCover: false,
      slices: [{ id: 's1', name: '', startDate: '2025-01-01', endDate: '2025-01-31' }],
      data: {
        type: 'stac_browser',
        catalogUrl: 'https://example.test/stac',
        stacCollectionId: 'sentinel',
        isMpc: false,
        mode: 'mosaic',
        visualizations: config('Sentinel').visualizations,
        vizUrls: [],
      },
    },
    {
      id: 'landsat-window',
      name: 'Landsat window',
      generationSeriesId: 'landsat-series',
      coverSliceIndex: 0,
      hasDedicatedCover: false,
      slices: [{ id: 's2', name: '', startDate: '2024-01-01', endDate: '2024-01-31' }],
      data: {
        type: 'stac_browser',
        catalogUrl: 'https://example.test/stac',
        stacCollectionId: 'landsat',
        isMpc: false,
        mode: 'mosaic',
        visualizations: config('Landsat').visualizations,
        vizUrls: [],
      },
    },
  ],
};

const controller = {
  state: { sources: [source], basemaps: [] },
  campaignBbox: null,
  mode: 'draft',
  pending: false,
  projectId: 1,
  isDirty: false,
  save: vi.fn(),
  discard: vi.fn(),
  addSource: vi.fn(),
  updateSource: vi.fn(),
  removeSource: vi.fn(),
  addCollection: vi.fn(),
  updateCollection: vi.fn(),
  removeCollection: vi.fn(),
  refreshCollection: vi.fn(),
  refreshSource: vi.fn(),
  setBasemaps: vi.fn(),
} satisfies ImageryController;

describe('SourceEditor generation series', () => {
  it('offers every saved series independently', () => {
    render(<SourceEditor source={source} controller={controller} onClose={() => {}} />);

    expect(screen.getByText('Edit Sentinel series')).toBeTruthy();
    expect(screen.getByText('Edit Landsat series')).toBeTruthy();
  });
});
