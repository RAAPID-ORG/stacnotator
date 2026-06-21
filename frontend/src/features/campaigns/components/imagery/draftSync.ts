import type {
  BasemapCreate,
  CampaignCreate,
  ImageryCollectionCreate,
  ImagerySourceCreate,
  VizParamsCreate,
} from '~/api/client';
import type { Basemap, CollectionItem, ImagerySource, ImageryStepState, VizParams } from './types';
import { emptyVizParams } from './types';
import { VIZ_PARAMS_FIELD_MAP } from './vizParamsMapping';

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

const toVizParamsPayload = (v: VizParams): VizParamsCreate => {
  const result: Record<string, unknown> = {};
  for (const entry of VIZ_PARAMS_FIELD_MAP) {
    result[entry.apiKey] = entry.toApi ? entry.toApi(v) : v[entry.feKey];
  }
  return result as VizParamsCreate;
};

export function collectionToBackend(
  col: CollectionItem,
  sourceVizNames: string[] = []
): ImageryCollectionCreate {
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
