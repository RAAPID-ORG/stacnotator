import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  saveImagery as apiSaveImagery,
  refreshCollectionImagery as apiRefreshCollection,
} from '~/api/client';
import type {
  ImageryEditorStateCreate,
  ImageryGenerationConfigV1,
  ImagerySourceOut,
  ImageryCollectionOut,
} from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { basemapToBackend, sourceToBackend } from './draftSync';
import type {
  Basemap,
  CollectionItem,
  ImagerySource,
  ImageryStepState,
  ManualCollectionData,
  StacBrowserCollectionData,
  VizParams,
  ImageryGenerationConfig,
} from './types';

export type ControllerMode = 'draft' | 'persisted';

export interface ImageryController {
  readonly state: ImageryStepState;
  readonly campaignBbox: number[] | null;
  readonly mode: ControllerMode;
  readonly pending: boolean;
  /** Persisted-mode campaign id (undefined in draft/wizard mode, where entities aren't saved
   *  yet). Used by the API-key controls, which act on persisted basemaps/sources only. */
  readonly campaignId?: number;
  /** Owning project. Scopes tiler discovery and STAC catalog listing, which are
   *  organization-level capabilities rather than per-user ones. */
  readonly projectId: number;

  /** Persisted mode only: true when local state differs from server truth. */
  readonly isDirty: boolean;
  /** Persisted mode: flush all queued edits to the server in one batch.
   *  Draft mode: no-op (the parent form handles persistence on submit). */
  save(): Promise<void>;
  /** Persisted mode: throw away local edits and revert to server truth.
   *  Draft mode: no-op. */
  discard(): void;

  addSource(source: ImagerySource): Promise<void>;
  updateSource(id: string, patch: Partial<ImagerySource>): Promise<void>;
  removeSource(id: string): Promise<void>;

  addCollection(sourceId: string, collection: CollectionItem): Promise<void>;
  updateCollection(
    sourceId: string,
    collectionId: string,
    patch: Partial<CollectionItem>
  ): Promise<void>;
  removeCollection(sourceId: string, collectionId: string): Promise<void>;
  refreshCollection(sourceId: string, collectionId: string): Promise<void>;

  setBasemaps(basemaps: Basemap[]): Promise<void>;
}

function withoutCollection(source: ImagerySource, collectionId: string): Partial<ImagerySource> {
  const collections = source.collections.filter((collection) => collection.id !== collectionId);
  const referencedSeries = new Set(
    collections.flatMap((collection) =>
      collection.generationSeriesId ? [collection.generationSeriesId] : []
    )
  );
  return {
    collections,
    generationSeries: source.generationSeries.filter((series) => referencedSeries.has(series.id)),
  };
}

// viz_params serialization (VizParams -> API payload) lives in draftSync.ts as
// `toVizParamsPayload` - the single writer used by the save path. This module only
// owns the inverse (API -> VizParams) below.
export function vizParamsToFrontend(d: Record<string, unknown> | null | undefined): VizParams {
  const p = d ?? {};
  return {
    assets: (p.assets as string[]) ?? [],
    assetAsBand: (p.asset_as_band as boolean) ?? false,
    bidx: (p.bidx as number[]) ?? undefined,
    rescale: (p.rescale as string) ?? '',
    colormapName: (p.colormap_name as string) ?? undefined,
    colorFormula: (p.color_formula as string) ?? undefined,
    expression: (p.expression as string) ?? undefined,
    resampling: (p.resampling as string) ?? undefined,
    compositing: (p.compositing as string) ?? undefined,
    nodata: (p.nodata as number) ?? undefined,
    extraParams: (p.extra_params as Record<string, string>) ?? undefined,
    maskLayer: (p.mask_layer as string) ?? undefined,
    maskValues: (p.mask_values as number[]) ?? undefined,
    nirBand: (p.nir_band as string) ?? undefined,
    redBand: (p.red_band as string) ?? undefined,
    maxItems: (p.max_items as number) ?? undefined,
  };
}

export interface DraftControllerOptions {
  projectId: number;
  state: ImageryStepState;
  setState: (next: ImageryStepState) => void;
  campaignBbox?: number[] | null;
}

export function useDraftController({
  projectId,
  state,
  setState,
  campaignBbox = null,
}: DraftControllerOptions): ImageryController {
  // Read freshest state on writes - without this, queued setState calls
  // would clobber each other via stale closures.
  const stateRef = useRef(state);
  stateRef.current = state;

  const update = useCallback(
    (next: ImageryStepState) => {
      stateRef.current = next;
      setState(next);
    },
    [setState]
  );

  const patchSource = useCallback(
    (id: string, patch: Partial<ImagerySource>) => {
      const cur = stateRef.current;
      update({
        ...cur,
        sources: cur.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      });
    },
    [update]
  );

  return useMemo<ImageryController>(
    () => ({
      state,
      campaignBbox,
      projectId,
      mode: 'draft',
      pending: false,
      // Draft mode persists at form submit; controller-level save/dirty are
      // not meaningful here.
      isDirty: false,
      save: async () => {},
      discard: () => {},

      addSource: async (source) => {
        update({ ...stateRef.current, sources: [...stateRef.current.sources, source] });
      },

      updateSource: async (id, patch) => patchSource(id, patch),

      removeSource: async (id) => {
        const cur = stateRef.current;
        update({ ...cur, sources: cur.sources.filter((s) => s.id !== id) });
      },

      addCollection: async (sourceId, collection) => {
        const src = stateRef.current.sources.find((s) => s.id === sourceId);
        if (src) patchSource(sourceId, { collections: [...src.collections, collection] });
      },

      updateCollection: async (sourceId, collectionId, patch) => {
        const src = stateRef.current.sources.find((s) => s.id === sourceId);
        if (!src) return;
        patchSource(sourceId, {
          collections: src.collections.map((c) => (c.id === collectionId ? { ...c, ...patch } : c)),
        });
      },

      removeCollection: async (sourceId, collectionId) => {
        const src = stateRef.current.sources.find((s) => s.id === sourceId);
        if (!src) return;
        patchSource(sourceId, withoutCollection(src, collectionId));
      },

      refreshCollection: async () => {
        // No-op in draft - collections resolve at campaign-create time.
      },

      setBasemaps: async (basemaps) => {
        update({ ...stateRef.current, basemaps });
      },
    }),
    [state, campaignBbox, projectId, update, patchSource]
  );
}

function isMpcCatalogUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'planetarycomputer.microsoft.com' ||
      host.endsWith('.planetarycomputer.microsoft.com')
    );
  } catch {
    return false;
  }
}

function generationConfigToFrontend(config: ImageryGenerationConfigV1): ImageryGenerationConfig {
  return {
    version: 1,
    catalogUrl: config.catalog_url,
    stacCollectionId: config.stac_collection_id,
    collectionTitle: config.collection_title,
    isMpc: config.is_mpc,
    hasCloudCover: config.has_cloud_cover,
    tiler: config.tiler,
    startDate: config.start_date,
    endDate: config.end_date,
    collectionPeriodInterval: config.collection_period_interval,
    collectionPeriodUnit: config.collection_period_unit,
    slicePeriodInterval: config.slice_period_interval,
    slicePeriodUnit: config.slice_period_unit,
    coverMode: config.cover_mode,
    coverSliceNth: config.cover_slice_nth,
    maxCloudCover: config.max_cloud_cover,
    itemSort: config.item_sort,
    coverMaxCloudCover: config.cover_max_cloud_cover,
    coverItemSort: config.cover_item_sort,
    visualizations: config.visualizations.map((viz) => ({
      name: viz.name,
      vizParams: vizParamsToFrontend(viz.viz_params),
    })),
    coverVisualizations: (config.cover_visualizations ?? []).map((viz) => ({
      name: viz.name,
      vizParams: vizParamsToFrontend(viz.viz_params),
    })),
    searchQuery: config.search_query ?? undefined,
    coverSearchQuery: config.cover_search_query ?? undefined,
    internalStorage: config.internal_storage,
  };
}

function mapCollectionOutToFe(col: ImageryCollectionOut, sourceVizNames: string[]): CollectionItem {
  const sc = col.stac_config;
  const isStacBrowser = !!sc?.catalog_url;

  const vizUrls = col.slices.flatMap((sl) =>
    sl.tile_urls.map((tu) => ({ vizName: tu.visualization_name, url: tu.tile_url }))
  );

  let data: StacBrowserCollectionData | ManualCollectionData;
  if (isStacBrowser && sc) {
    // One viz_config row per named visualization; cover params are stored only
    // when the collection has a dedicated cover.
    const vizConfigs = sc.viz_configs ?? [];
    const byName = new Map(vizConfigs.map((vc) => [vc.name, vc]));
    const namesForViz = sourceVizNames.length > 0 ? sourceVizNames : ['Default'];
    const hasDedicatedCover = col.has_dedicated_cover ?? false;
    data = {
      type: 'stac_browser',
      catalogUrl: sc.catalog_url ?? '',
      stacCollectionId: sc.stac_collection_id ?? '',
      isMpc: isMpcCatalogUrl(sc.catalog_url),
      tiler: sc.tiler ?? null,
      mode: 'mosaic',
      maxCloudCover: sc.max_cloud_cover ?? undefined,
      visualizations: namesForViz.map((name) => ({
        name,
        vizParams: vizParamsToFrontend(byName.get(name)?.render_params),
      })),
      coverVisualizations: hasDedicatedCover
        ? namesForViz.map((name) => ({
            name,
            vizParams: vizParamsToFrontend(byName.get(name)?.cover_render_params),
          }))
        : undefined,
      searchQuery: (sc.search_query as Record<string, unknown>) ?? undefined,
      coverSearchQuery: (sc.cover_search_query as Record<string, unknown>) ?? undefined,
      internalStorage: sc.internal_storage ?? false,
      vizUrls,
    };
  } else {
    data = { type: 'manual', vizUrls };
  }

  return {
    id: String(col.id),
    name: col.name,
    generationSeriesId: col.generation_series_id != null ? String(col.generation_series_id) : null,
    coverSliceIndex: col.cover_slice_index ?? 0,
    hasDedicatedCover: col.has_dedicated_cover ?? false,
    slices: col.slices.map((sl) => ({
      id: String(sl.id),
      name: sl.name,
      startDate: sl.start_date,
      endDate: sl.end_date,
      vizUrls: sl.tile_urls.map((tu) => ({ vizName: tu.visualization_name, url: tu.tile_url })),
    })),
    data,
  };
}

function mapSourceOutToFe(src: ImagerySourceOut): ImagerySource {
  const vizNames = src.visualizations.map((v) => v.name);
  return {
    id: String(src.id),
    name: src.name,
    crosshairHex6: src.crosshair_hex6,
    defaultZoom: src.default_zoom,
    visualizations: src.visualizations.map((v) => ({ name: v.name })),
    generationSeries: (src.generation_series ?? []).map((series) => ({
      id: String(series.id),
      config: generationConfigToFrontend(series.config),
    })),
    collections: src.collections.map((col) => mapCollectionOutToFe(col, vizNames)),
    hasApiKey: src.has_api_key,
  };
}

/** Serialize the local editor state into the upsert payload. Existing
 *  entities pass their real numeric IDs through; freshly-added entities omit
 *  `id` (server treats as create). */
function stateToEditorPayload(state: ImageryStepState): ImageryEditorStateCreate {
  return {
    sources: state.sources.map(sourceToBackend),
    basemaps: state.basemaps.map(basemapToBackend),
  };
}

export interface PersistedControllerOptions {
  campaignId: number;
  projectId: number;
  imagery: ImagerySourceOut[];
  basemaps?: {
    id?: number;
    name: string;
    url: string;
    max_native_zoom?: number | null;
    has_api_key?: boolean;
  }[];
  campaignBbox?: number[] | null;
  /** Called after any mutation succeeds so the parent can refetch. */
  refetch?: () => void;
}

export function usePersistedController({
  campaignId,
  projectId,
  imagery,
  basemaps,
  campaignBbox = null,
  refetch,
}: PersistedControllerOptions): ImageryController {
  const initialState = useMemo<ImageryStepState>(
    () => ({
      sources: imagery.map(mapSourceOutToFe),
      basemaps: (basemaps ?? []).map((b, i) => ({
        id: b.id !== undefined ? String(b.id) : `local-${i}`,
        name: b.name,
        url: b.url,
        maxNativeZoom: b.max_native_zoom ?? undefined,
        hasApiKey: b.has_api_key,
      })),
    }),
    [imagery, basemaps]
  );

  const [state, setState] = useState<ImageryStepState>(initialState);
  const [isDirty, setIsDirty] = useState(false);
  const [pending, setPending] = useState(false);

  // Refs read by save() so the diff sees the freshest values even if React has
  // queued multiple setState calls. Without these, fast successive edits could
  // produce a diff computed against a stale snapshot.
  const stateRef = useRef(state);
  stateRef.current = state;
  const initialStateRef = useRef(initialState);
  initialStateRef.current = initialState;

  // Set by save() right before it triggers refetch(). The useEffect below uses
  // it to know that the incoming props update is the post-save refresh - at
  // that point we adopt server truth unconditionally and clear dirty/pending.
  const awaitingPostSaveRefetch = useRef(false);

  useEffect(() => {
    if (awaitingPostSaveRefetch.current) {
      awaitingPostSaveRefetch.current = false;
      setState(initialState);
      setIsDirty(false);
      setPending(false);
    } else if (!isDirty) {
      // Routine prop refresh while user has no pending edits - adopt server
      // truth. If the user is mid-edit (isDirty=true), preserve their work.
      setState(initialState);
    }
    // intentionally not depending on isDirty: this effect should only fire on
    // an actual props refresh, not whenever dirty flips. We read the current
    // isDirty value at the time the effect runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialState]);

  const mutate = useCallback((updater: (s: ImageryStepState) => ImageryStepState) => {
    setState((s) => updater(s));
    setIsDirty(true);
  }, []);

  const discard = useCallback(() => {
    setState(initialStateRef.current);
    setIsDirty(false);
  }, []);

  const save = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await apiSaveImagery({
        path: { campaign_id: campaignId },
        body: stateToEditorPayload(stateRef.current),
      });
      awaitingPostSaveRefetch.current = true;
      refetch?.();
      setTimeout(() => {
        if (awaitingPostSaveRefetch.current) {
          awaitingPostSaveRefetch.current = false;
          setIsDirty(false);
          setPending(false);
        }
      }, 5000);
    } catch (e) {
      handleError(e, 'Failed to save imagery changes');
      refetch?.();
      setPending(false);
      throw e;
    }
  }, [pending, campaignId, refetch]);

  return useMemo<ImageryController>(
    () => ({
      state,
      campaignBbox,
      projectId,
      mode: 'persisted',
      pending,
      isDirty,
      campaignId,
      save,
      discard,

      addSource: async (source) => {
        mutate((s) => ({ ...s, sources: [...s.sources, source] }));
      },

      updateSource: async (id, patch) => {
        mutate((s) => ({
          ...s,
          sources: s.sources.map((src) => (src.id === id ? { ...src, ...patch } : src)),
        }));
      },

      removeSource: async (id) => {
        mutate((s) => ({ ...s, sources: s.sources.filter((src) => src.id !== id) }));
      },

      addCollection: async (sourceId, collection) => {
        mutate((s) => ({
          ...s,
          sources: s.sources.map((src) =>
            src.id === sourceId ? { ...src, collections: [...src.collections, collection] } : src
          ),
        }));
      },

      updateCollection: async (sourceId, collectionId, patch) => {
        mutate((s) => ({
          ...s,
          sources: s.sources.map((src) =>
            src.id !== sourceId
              ? src
              : {
                  ...src,
                  collections: src.collections.map((c) =>
                    c.id === collectionId ? { ...c, ...patch } : c
                  ),
                }
          ),
        }));
      },

      removeCollection: async (sourceId, collectionId) => {
        mutate((s) => ({
          ...s,
          sources: s.sources.map((src) =>
            src.id === sourceId ? { ...src, ...withoutCollection(src, collectionId) } : src
          ),
        }));
      },

      refreshCollection: async (_sourceId, collectionId) => {
        // Refresh is a server-side side-effect (re-fetch STAC items, re-register
        // mosaic) and operates against persisted state. Block when dirty so it
        // doesn't run against a stale config - user must Save first.
        if (isDirty) {
          handleError(
            new Error('Save your changes before refreshing this collection.'),
            'Cannot refresh'
          );
          return;
        }
        setPending(true);
        try {
          await apiRefreshCollection({
            path: { campaign_id: campaignId, collection_id: Number(collectionId) },
          });
          refetch?.();
        } catch (e) {
          handleError(e, 'Failed to refresh collection');
        } finally {
          setPending(false);
        }
      },

      setBasemaps: async (basemaps) => {
        mutate((s) => ({ ...s, basemaps }));
      },
    }),
    [state, campaignBbox, projectId, pending, isDirty, save, discard, mutate, campaignId, refetch]
  );
}
