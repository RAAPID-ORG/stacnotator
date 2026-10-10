import { describe, expect, it } from 'vitest';
import type { ImagerySourceOut } from '~/api/client';
import { COLLECTION_PRESETS, presetVizParams } from './collectionPresets';
import { mapSourceOutToFe } from './controller';
import { sourceToBackend } from './draftSync';
import { editableGenerationSeries } from './generation';
import type { ImagerySource, StacBrowserCollectionData } from './types';
import {
  followingCoverParams,
  rewriteVisualization,
  updateRegularVisualization,
} from './visualizations';

const falseColor = presetVizParams(COLLECTION_PRESETS['sentinel-2-l2a'][1], 'sentinel-2-l2a');
const ndvi = presetVizParams(COLLECTION_PRESETS['sentinel-2-l2a'][5], 'sentinel-2-l2a');
const data: StacBrowserCollectionData = {
  type: 'stac_browser',
  catalogUrl: 'https://example.test/stac',
  stacCollectionId: 'sentinel-2-l2a',
  isMpc: false,
  mode: 'mosaic',
  visualizations: [{ name: 'Vegetation', vizParams: falseColor }],
  coverVisualizations: [{ name: 'Vegetation', vizParams: { ...falseColor, compositing: 'first' } }],
  vizUrls: [{ vizName: 'Vegetation', url: 'https://tiles.test/false-color' }],
};
const source: ImagerySource = {
  id: '7',
  name: 'Sentinel',
  crosshairHex6: 'ff0000',
  defaultZoom: 15,
  visualizations: [{ name: 'Vegetation' }],
  collections: [
    {
      id: '42',
      name: 'January',
      generationSeriesId: '12',
      hasDedicatedCover: true,
      coverSliceIndex: 0,
      slices: [
        {
          id: '100',
          name: 'Cover',
          startDate: '2025-01-01',
          endDate: '2025-01-31',
          vizUrls: data.vizUrls,
        },
      ],
      data,
    },
  ],
  generationSeries: [
    {
      id: '12',
      config: {
        version: 1,
        catalogUrl: data.catalogUrl,
        stacCollectionId: data.stacCollectionId,
        collectionTitle: 'Sentinel',
        isMpc: false,
        hasCloudCover: true,
        startDate: '2025-01',
        endDate: '2025-01',
        collectionPeriodInterval: 1,
        collectionPeriodUnit: 'months',
        slicePeriodInterval: 1,
        slicePeriodUnit: 'weeks',
        coverMode: 'custom',
        coverSliceNth: 1,
        maxCloudCover: 90,
        itemSort: 'date_desc',
        coverMaxCloudCover: 90,
        coverItemSort: 'date_desc',
        visualizations: data.visualizations,
        coverVisualizations: data.coverVisualizations ?? [],
      },
    },
  ],
};

describe('visualization preservation', () => {
  it('keeps a following cover on NDVI after replacing false color, without replacing compositing', () => {
    const result = updateRegularVisualization(
      data,
      'Vegetation',
      { ...ndvi, compositing: 'mean' },
      true
    );
    expect(result.visualizations[0].vizParams.expression).toBe(ndvi.expression);
    expect(result.coverVisualizations?.[0].vizParams).toEqual({ ...ndvi, compositing: 'first' });
    expect(data.visualizations[0].vizParams).toEqual(falseColor);
  });

  it('preserves independently configured covers', () => {
    const custom = { ...ndvi, colormapName: 'viridis', compositing: 'median' };
    expect(followingCoverParams(falseColor, custom, ndvi)).toBe(custom);
    expect(followingCoverParams(falseColor, undefined, ndvi)).toEqual({
      ...ndvi,
      compositing: 'first',
    });
  });

  it('compares rendering semantically instead of by object key order', () => {
    const cover = {
      rescale: falseColor.rescale,
      colorFormula: falseColor.colorFormula,
      assets: [...falseColor.assets],
      assetAsBand: falseColor.assetAsBand,
      nodata: falseColor.nodata,
      extraParams: undefined,
      compositing: 'median',
    };
    expect(followingCoverParams(falseColor, cover, ndvi)).toEqual({
      ...ndvi,
      compositing: 'median',
    });
  });

  it('renames params, covers, URLs and generator snapshots together', () => {
    const renamed = { ...source, ...rewriteVisualization(source, 0, 'NDVI') };
    const payload = sourceToBackend(renamed);
    const viz = payload.collections[0].stac_config?.visualizations?.[0];
    expect(viz?.name).toBe('NDVI');
    expect(viz?.viz_params.assets).toEqual(falseColor.assets);
    expect(viz?.cover_viz_params?.assets).toEqual(falseColor.assets);
    expect(renamed.collections[0].data.vizUrls[0].vizName).toBe('NDVI');
    expect(renamed.collections[0].slices[0].vizUrls?.[0].vizName).toBe('NDVI');
    expect(editableGenerationSeries(renamed)[0].config.visualizations[0].name).toBe('NDVI');
    expect(payload.generation_series?.[0].config).toMatchObject({
      visualizations: [{ name: 'NDVI' }],
      cover_visualizations: [{ name: 'NDVI' }],
    });
  });

  it('removes only the selected visualization from all representations', () => {
    const multiple: ImagerySource = {
      ...source,
      visualizations: [{ name: 'Vegetation' }, { name: 'NDVI' }],
      collections: [
        {
          ...source.collections[0],
          data: {
            ...data,
            visualizations: [...data.visualizations, { name: 'NDVI', vizParams: ndvi }],
            coverVisualizations: [
              ...(data.coverVisualizations ?? []),
              { name: 'NDVI', vizParams: ndvi },
            ],
          },
        },
      ],
    };
    const removed = { ...multiple, ...rewriteVisualization(multiple, 0, null) };
    const payload = sourceToBackend(removed);
    expect(payload.visualizations).toEqual([{ name: 'NDVI' }]);
    expect(payload.collections[0].stac_config?.visualizations?.[0].viz_params.expression).toBe(
      ndvi.expression
    );
    expect(removed.collections[0].data.vizUrls).toEqual([]);
    expect(payload.generation_series?.[0].config).toMatchObject({
      visualizations: [],
      cover_visualizations: [],
    });
  });

  it('does not clone another visualization when a named configuration is missing', () => {
    const payload = sourceToBackend({
      ...source,
      visualizations: [{ name: 'Vegetation' }, { name: 'Unconfigured' }],
    });
    expect(payload.collections[0].stac_config?.visualizations?.[1].viz_params.assets).toEqual([]);
  });

  it('retains all NDVI parameters when saving, reloading, editing and saving again', () => {
    const updated: ImagerySource = {
      ...source,
      collections: [
        {
          ...source.collections[0],
          data: updateRegularVisualization(
            data,
            'Vegetation',
            {
              ...ndvi,
              nodata: 0,
              maskLayer: 'SCL',
              maskValues: [0, 8, 9],
              extraParams: { custom: 'value' },
            },
            true
          ),
        },
      ],
    };
    const first = sourceToBackend(updated);
    const saved = first.collections[0].stac_config!;
    const response: ImagerySourceOut = {
      id: 7,
      name: source.name,
      crosshair_hex6: source.crosshairHex6,
      default_zoom: source.defaultZoom,
      display_order: 0,
      visualizations: [{ id: 1, name: 'Vegetation', display_order: 0 }],
      collections: [
        {
          id: 42,
          name: 'January',
          display_order: 0,
          cover_slice_index: 0,
          has_dedicated_cover: true,
          slices: [],
          stac_config: {
            catalog_url: saved.catalog_url,
            stac_collection_id: saved.stac_collection_id,
            viz_configs: saved.visualizations?.map((viz, i) => ({
              id: i,
              display_order: i,
              name: viz.name,
              render_params: { ...viz.viz_params },
              cover_render_params: { ...viz.cover_viz_params },
            })),
          },
        },
      ],
    };
    const reloaded = mapSourceOutToFe(response);
    expect(sourceToBackend(reloaded).collections[0].stac_config?.visualizations).toEqual(
      saved.visualizations
    );
  });
});
