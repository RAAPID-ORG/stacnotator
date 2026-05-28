import type {
  BasemapCreate,
  CampaignCreate,
  ImageryCollectionCreate,
  ImagerySourceCreate,
  VizParamsCreate,
} from '~/api/client';
import type { Basemap, CollectionItem, ImagerySource, ImageryStepState, VizParams } from './types';

/** Local IDs are strings: real DB rows are numeric strings (from server),
 *  freshly-added entities are random UUID slices. Only emit `id` when it's a
 *  real DB ID — backend treats missing IDs as "create this entity". */
const toIdField = (id: string): number | undefined => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export const isRealId = (id: string): boolean => toIdField(id) !== undefined;

const toVizParamsPayload = (v: VizParams): VizParamsCreate => ({
  assets: v.assets,
  asset_as_band: v.assetAsBand,
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

export function collectionToBackend(col: CollectionItem): ImageryCollectionCreate {
  return {
    id: toIdField(col.id),
    name: col.name,
    cover_slice_index: col.coverSliceIndex,
    has_dedicated_cover: col.hasDedicatedCover,
    slices: col.slices.map((sl) => ({
      id: toIdField(sl.id),
      name: sl.name || undefined,
      start_date: sl.startDate,
      end_date: sl.endDate,
      tile_urls:
        col.data.type === 'stac_browser'
          ? []
          : col.data.type === 'manual' && sl.vizUrls
            ? sl.vizUrls
                .filter((v) => v.url)
                .map((v) => ({ visualization_name: v.vizName, tile_url: v.url }))
            : col.data.vizUrls
                .filter((v) => v.url)
                .map((v) => ({ visualization_name: v.vizName, tile_url: v.url })),
    })),
    stac_config:
      col.data.type === 'stac' && col.data.registrationUrl
        ? { registration_url: col.data.registrationUrl, search_body: col.data.searchBody }
        : col.data.type === 'stac_browser'
          ? (() => {
              const data = col.data;
              return {
                registration_url: '',
                search_body: '',
                catalog_url: data.catalogUrl,
                stac_collection_id: data.stacCollectionId,
                visualizations: (data.visualizations ?? [])
                  .filter((v) => v.vizParams)
                  .map((v) => {
                    const cover = data.coverVisualizations?.find((c) => c.name === v.name);
                    return {
                      name: v.name,
                      viz_params: toVizParamsPayload(v.vizParams),
                      cover_viz_params: cover?.vizParams
                        ? toVizParamsPayload(cover.vizParams)
                        : undefined,
                    };
                  }),
                max_cloud_cover: data.maxCloudCover,
                search_query: data.searchQuery ?? null,
                cover_search_query: data.coverSearchQuery ?? null,
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
    visualizations: src.visualizations.map((v) => ({ name: v.name })),
    collections: src.collections.map(collectionToBackend),
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
  const views = state.views.map((v) => ({
    name: v.name,
    collection_refs: v.collectionRefs
      .map((ref) => {
        const srcIdx = state.sources.findIndex((src) => src.id === ref.sourceId);
        if (srcIdx === -1) return null;
        const colIdx = state.sources[srcIdx].collections.findIndex(
          (c) => c.id === ref.collectionId
        );
        if (colIdx === -1) return null;
        return {
          collection_id: String(colIdx),
          source_id: String(srcIdx),
          show_as_window: ref.showAsWindow,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  }));
  const basemaps = state.basemaps.map(basemapToBackend);

  setForm({
    ...form,
    imagery_editor_state: sources.length > 0 ? { sources, views, basemaps } : null,
  });
}
