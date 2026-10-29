import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogBrowserResult } from './CatalogBrowser';
import type { ImageryController } from './controller';
import { SourceEditor } from './SourceEditor';
import type { CollectionItem, ImageryGenerationConfig, ImagerySource } from './types';

// The generator itself is covered by its own tests; here it hands back a
// regenerated series with one visualization more than the source has.
vi.mock('./CatalogBrowser', () => ({
  CatalogBrowser: ({ onAdd }: { onAdd: (result: CatalogBrowserResult) => void }) => (
    <button type="button" onClick={() => onAdd(regenerated)}>
      regenerate
    </button>
  ),
}));

const config = (title: string): ImageryGenerationConfig => ({
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
        visualizations: config('Landsat').visualizations,
        vizUrls: [],
      },
    },
  ],
};

const ndvi = { name: 'NDVI', vizParams: { assets: ['nir'], assetAsBand: false, rescale: '' } };
const sentinelWindow = source.collections[0] as CollectionItem & {
  data: { type: 'stac_browser' };
};
const regenerated: CatalogBrowserResult = {
  collections: [
    {
      ...sentinelWindow,
      data: {
        ...sentinelWindow.data,
        visualizations: [...sentinelWindow.data.visualizations, ndvi],
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
  allowsPrivateCatalogs: true,
  isDirty: false,
  save: vi.fn(),
  discard: vi.fn(),
  addSource: vi.fn(),
  updateSource: vi.fn(),
  removeSource: vi.fn(),
  addCollection: vi.fn(),
  updateCollection: vi.fn(),
  removeCollection: vi.fn(),
  refreshSource: vi.fn(),
  setBasemaps: vi.fn(),
} satisfies ImageryController;

describe('SourceEditor generation series', () => {
  it('offers every saved series independently', () => {
    render(<SourceEditor source={source} controller={controller} onClose={() => {}} />);

    expect(screen.getByText('Edit all Sentinel')).toBeTruthy();
    expect(screen.getByText('Edit all Landsat')).toBeTruthy();
  });
});

describe('SourceEditor series regeneration', () => {
  it('adds a visualization created in the generator to the source', async () => {
    render(<SourceEditor source={source} controller={controller} onClose={() => {}} />);

    await userEvent.click(screen.getByText('Edit all Sentinel'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'regenerate' }));

    const patch = controller.updateSource.mock.calls.at(-1)![1];
    expect(patch.visualizations).toEqual([{ name: 'RGB' }, { name: 'NDVI' }]);
    const [sentinel] = patch.collections!;
    expect(
      sentinel.data.type === 'stac_browser' &&
        sentinel.data.visualizations.map((v: { name: string }) => v.name)
    ).toEqual(['RGB', 'NDVI']);
  });
});
