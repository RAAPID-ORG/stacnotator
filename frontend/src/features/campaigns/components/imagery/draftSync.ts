import type {
  BasemapCreate,
  CampaignCreate,
  ImageryCollectionCreate,
  ImageryGenerationConfigV1,
  ImagerySourceCreate,
  VizParamsCreate,
} from '~/api/client';
import type {
  Basemap,
  CollectionItem,
  ImageryGenerationConfig,
  ImagerySource,
  ImageryStepState,
  VizParams,
} from './types';
import { emptyVizParams, isPlanetSceneConfig } from './types';

/** Local IDs are strings: real DB rows are decimal-integer strings (from
 *  server), freshly-added entities are random UUID slices. Only emit `id`
 *  when it's a real DB ID - backend treats missing IDs as "create this
 *  entity". Strict regex avoids `Number()` quirks (scientific notation, hex,
 *  whitespace) silently coercing a UUID slice into a giant fake ID. */
const toIdField = (id: string): number | undefined => {
  if (!/^[1-9][0-9]*$/.test(id)) return undefined;
  const n = Number(id);
  return Number.isSafeInteger(n) ? n : undefined;
};

export const isRealId = (id: string): boolean => toIdField(id) !== undefined;

const toVizParamsPayload = (v: VizParams): VizParamsCreate => ({
  assets: v.assets,
  asset_as_band: v.assetAsBand,
  bidx: v.bidx?.length ? v.bidx : undefined,
  rescale: v.rescale || undefined,
  colormap_name: v.colormapName,
  color_formula: v.colorFormula,
  expression: v.expression,
  resampling: v.resampling,
  compositing: v.compositing,
  nodata: v.nodata,
  extra_params: v.extraParams,
  mask_layer: v.maskLayer,
  mask_values: v.maskValues,
  nir_band: v.nirBand,
  red_band: v.redBand,
  max_items: v.maxItems,
});

const generationConfigToBackend = (config: ImageryGenerationConfig): ImageryGenerationConfigV1 => ({
  version: 1,
  catalog_url: config.catalogUrl,
  stac_collection_id: config.stacCollectionId,
  collection_title: config.collectionTitle,
  is_mpc: config.isMpc,
  has_cloud_cover: config.hasCloudCover,
  tiler: config.tiler,
  start_date: config.startDate,
  end_date: config.endDate,
  collection_period_interval: config.collectionPeriodInterval,
  collection_period_unit: config.collectionPeriodUnit,
  slice_period_interval: config.slicePeriodInterval,
  slice_period_unit: config.slicePeriodUnit,
  cover_mode: config.coverMode,
  cover_slice_nth: config.coverSliceNth,
  max_cloud_cover: config.maxCloudCover,
  item_sort: config.itemSort,
  cover_max_cloud_cover: config.coverMaxCloudCover,
  cover_item_sort: config.coverItemSort,
  visualizations: config.visualizations.map((viz) => ({
    name: viz.name,
    viz_params: toVizParamsPayload(viz.vizParams),
  })),
  cover_visualizations: config.coverVisualizations.map((viz) => ({
    name: viz.name,
    viz_params: toVizParamsPayload(viz.vizParams),
  })),
  search_query: config.searchQuery,
  cover_search_query: config.coverSearchQuery,
  internal_storage: config.internalStorage ?? false,
});

export function collectionToBackend(
  col: CollectionItem,
  sourceVizNames: string[] = []
): ImageryCollectionCreate {
  return {
    id: toIdField(col.id),
    name: col.name,
    cover_slice_index: col.coverSliceIndex,
    has_dedicated_cover: col.hasDedicatedCover,
    generation_series_key: col.generationSeriesId ?? null,
    slices: col.slices.map((sl) => ({
      id: toIdField(sl.id),
      name: sl.name || undefined,
      start_date: sl.startDate,
      end_date: sl.endDate,
      tile_urls:
        col.data.type === 'stac_browser'
          ? []
          : (sl.vizUrls ?? [])
              .filter((v) => v.url)
              .map((v) => ({ visualization_name: v.vizName, tile_url: v.url })),
    })),
    stac_config:
      col.data.type === 'stac_browser'
        ? (() => {
            const data = col.data;
            const configured = (data.visualizations ?? []).filter((v) => v.vizParams);
            const paramsByName = new Map(configured.map((v) => [v.name, v.vizParams]));
            const fallbackParams = configured[0]?.vizParams ?? emptyVizParams();
            const names = sourceVizNames.length ? sourceVizNames : configured.map((v) => v.name);
            return {
              catalog_url: data.catalogUrl,
              stac_collection_id: data.stacCollectionId,
              tiler: data.tiler ?? null,
              visualizations: names.map((name) => {
                const cover = data.coverVisualizations?.find((c) => c.name === name);
                return {
                  name,
                  viz_params: toVizParamsPayload(paramsByName.get(name) ?? fallbackParams),
                  cover_viz_params: cover?.vizParams
                    ? toVizParamsPayload(cover.vizParams)
                    : undefined,
                };
              }),
              max_cloud_cover: data.maxCloudCover,
              search_query: data.searchQuery ?? null,
              cover_search_query: data.coverSearchQuery ?? null,
              internal_storage: data.internalStorage ?? false,
            };
          })()
        : null,
  };
}

export function sourceToBackend(src: ImagerySource): ImagerySourceCreate {
  return {
    id: toIdField(src.id),
    name: src.name,
    crosshair_hex6: src.crosshairHex6,
    default_zoom: src.defaultZoom,
    max_native_zoom: src.maxNativeZoom ?? null,
    // Both honoured on create only; rotating a key goes through the key endpoint.
    organization_api_key_id: src.organizationApiKeyId ?? null,
    api_key: src.apiKey || null,
    visualizations: src.visualizations.map((v) => ({ name: v.name })),
    generation_series: src.generationSeries.map((series) => ({
      key: series.id,
      id: toIdField(series.id),
      config: isPlanetSceneConfig(series.config)
        ? series.config
        : generationConfigToBackend(series.config),
    })),
    collections: src.collections.map((c) =>
      collectionToBackend(
        c,
        src.visualizations.map((v) => v.name)
      )
    ),
  };
}

export function basemapToBackend(b: Basemap): BasemapCreate {
  return {
    id: toIdField(b.id),
    name: b.name,
    url: b.url,
    max_native_zoom: b.maxNativeZoom ?? null,
  };
}

export function syncToForm(
  state: ImageryStepState,
  form: CampaignCreate,
  setForm: (f: CampaignCreate) => void
) {
  const sources = state.sources.map(sourceToBackend);
  const basemaps = state.basemaps.map(basemapToBackend);

  setForm({
    ...form,
    imagery_editor_state: sources.length > 0 ? { sources, basemaps } : null,
  });
}
