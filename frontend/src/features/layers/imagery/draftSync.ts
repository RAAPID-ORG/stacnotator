import type {
  BasemapCreate,
  CampaignCreate,
  ImageryCollectionCreate,
  StacGenerationConfig,
  ImagerySourceCreate,
  RenderParams,
} from '~/api/client';
import type {
  Basemap,
  CollectionItem,
  GenerationRecipe,
  ImagerySource,
  ImageryStepState,
  VizParams,
} from './types';
import { emptyVizParams, isPlanetSceneConfig } from './types';
import { buildStacAutoQuery } from './stacQuery';

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

const toVizParamsPayload = (v: VizParams): RenderParams => ({
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

const generationRecipeToBackend = (config: GenerationRecipe): StacGenerationConfig => ({
  kind: 'stac',
  collection_title: config.collectionTitle,
  has_cloud_cover: config.hasCloudCover,
  start_date: config.startDate,
  end_date: config.endDate,
  collection_period_interval: config.collectionPeriodInterval,
  collection_period_unit: config.collectionPeriodUnit,
  slice_period_interval: config.slicePeriodInterval,
  slice_period_unit: config.slicePeriodUnit,
  cover_mode: config.coverMode,
  cover_slice_nth: config.coverSliceNth,
});

/** A STAC collection's parameters for each of its source's visualizations; one the
 *  collection has none for yet goes out empty rather than borrowing another's. */
function stacVisualizations(
  col: CollectionItem,
  sourceVizNames: string[]
): ImageryCollectionCreate['visualizations'] {
  if (col.data.type !== 'stac_browser') return [];
  const data = col.data;
  const configured = (data.visualizations ?? []).filter((v) => v.vizParams);
  const paramsByName = new Map(configured.map((v) => [v.name, v.vizParams]));
  const names = sourceVizNames.length ? sourceVizNames : configured.map((v) => v.name);
  return names.map((name) => {
    const cover = data.coverVisualizations?.find((c) => c.name === name);
    return {
      visualization: name,
      params: toVizParamsPayload(paramsByName.get(name) ?? emptyVizParams()),
      cover_params: cover?.vizParams ? toVizParamsPayload(cover.vizParams) : undefined,
    };
  });
}

function collectionToBackend(
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
      templates:
        col.data.type === 'stac_browser'
          ? []
          : (sl.vizUrls ?? [])
              .filter((v) => v.url)
              .map((v) => ({ visualization: v.vizName, url: v.url })),
    })),
    visualizations: stacVisualizations(col, sourceVizNames),
    search:
      col.data.type === 'stac_browser'
        ? (() => {
            const data = col.data;
            return {
              catalog_url: data.catalogUrl,
              stac_collection_id: data.stacCollectionId,
              tiler: data.tiler ?? null,
              // A query left to the settings is built from them here, so the
              // stored search always matches what the editor shows.
              search_query:
                data.searchQuery ??
                buildStacAutoQuery(data.stacCollectionId, {
                  maxCloudCover: data.maxCloudCover,
                  itemSort: data.itemSort,
                }),
              cover_search_query: col.hasDedicatedCover
                ? (data.coverSearchQuery ??
                  (data.coverMaxCloudCover !== undefined || data.coverItemSort
                    ? buildStacAutoQuery(data.stacCollectionId, {
                        maxCloudCover: data.coverMaxCloudCover ?? data.maxCloudCover,
                        itemSort: data.coverItemSort ?? data.itemSort,
                      })
                    : null))
                : null,
              internal_storage: data.internalStorage ?? false,
              storage_access: data.sasToken
                ? { kind: 'azure_sas' as const, secret: data.sasToken }
                : null,
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
    organization_api_key_id: src.organizationApiKeyId ?? null,
    api_key: src.apiKey || null,
    visualizations: src.visualizations.map((v) => ({ id: toIdField(v.id ?? ''), name: v.name })),
    generation_series: src.generationSeries.map((series) => ({
      key: series.id,
      id: toIdField(series.id),
      config: isPlanetSceneConfig(series.config)
        ? series.config
        : generationRecipeToBackend(series.config),
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
    organization_api_key_id: b.organizationApiKeyId ?? null,
    api_key: b.apiKey || null,
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
