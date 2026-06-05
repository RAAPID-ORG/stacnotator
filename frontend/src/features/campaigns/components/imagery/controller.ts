import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  saveImagery as apiSaveImagery,
  refreshCollectionImagery as apiRefreshCollection,
} from '~/api/client';
import type {
  ImageryEditorStateCreate,
  ImagerySourceOut,
  ImageryCollectionOut,
  ImageryViewOut,
} from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { basemapToBackend, collectionToBackend, isRealId, sourceToBackend } from './draftSync';
import type {
  Basemap,
  CollectionItem,
  ImagerySource,
  ImageryStepState,
  ImageryView,
  ManualCollectionData,
  StacBrowserCollectionData,
  VizParams,
} from './types';

export type ControllerMode = 'draft' | 'persisted';

export interface ImageryController {
  readonly state: ImageryStepState;
  readonly campaignBbox: number[] | null;
  readonly mode: ControllerMode;
  readonly pending: boolean;

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

  addView(view: ImageryView): Promise<void>;
  updateView(id: string, patch: Partial<ImageryView>): Promise<void>;
  removeView(id: string): Promise<void>;
  reorderViews(ids: string[]): Promise<void>;

  setBasemaps(basemaps: Basemap[]): Promise<void>;
}

export function vizParamsToBackend(vp: VizParams): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (vp.assets.length > 0) d.assets = vp.assets;
  if (vp.assetAsBand) d.asset_as_band = true;
  if (vp.rescale) d.rescale = vp.rescale;
  if (vp.colormapName) d.colormap_name = vp.colormapName;
  if (vp.colorFormula) d.color_formula = vp.colorFormula;
  if (vp.expression) d.expression = vp.expression;
  if (vp.resampling) d.resampling = vp.resampling;
  if (vp.compositing) d.compositing = vp.compositing;
  if (vp.nodata !== undefined) d.nodata = vp.nodata;
  if (vp.extraParams && Object.keys(vp.extraParams).length > 0) d.extra_params = vp.extraParams;
  if (vp.maskLayer) d.mask_layer = vp.maskLayer;
  if (vp.maskValues?.length) d.mask_values = vp.maskValues;
  if (vp.nirBand) d.nir_band = vp.nirBand;
  if (vp.redBand) d.red_band = vp.redBand;
  if (vp.maxItems !== undefined) d.max_items = Math.max(1, Math.min(10, vp.maxItems));
  return d;
}

export function vizParamsToFrontend(d: Record<string, unknown> | null | undefined): VizParams {
  const p = d ?? {};
  return {
    assets: (p.assets as string[]) ?? [],
    assetAsBand: (p.asset_as_band as boolean) ?? false,
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
  state: ImageryStepState;
  setState: (next: ImageryStepState) => void;
  campaignBbox?: number[] | null;
}

export function useDraftController({
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
      const oldSource = cur.sources.find((s) => s.id === id);
      const nextSources = cur.sources.map((s) => (s.id === id ? { ...s, ...patch } : s));
      let nextViews = cur.views;

      if (patch.collections && oldSource) {
        const oldIds = new Set(oldSource.collections.map((c) => c.id));
        const newIds = new Set(patch.collections.map((c) => c.id));
        const added = patch.collections.filter((c) => !oldIds.has(c.id)).map((c) => c.id);
        const removed = [...oldIds].filter((cid) => !newIds.has(cid));

        if (added.length > 0 || removed.length > 0) {
          nextViews = cur.views.map((v) => {
            let refs = v.collectionRefs;
            if (removed.length > 0) {
              refs = refs.filter((r) => r.sourceId !== id || !removed.includes(r.collectionId));
            }
            if (added.length > 0 && refs.some((r) => r.sourceId === id)) {
              refs = [
                ...refs,
                ...added.map((cid) => ({ collectionId: cid, sourceId: id, showAsWindow: true })),
              ];
            }
            return refs !== v.collectionRefs ? { ...v, collectionRefs: refs } : v;
          });
        }
      }

      update({ ...cur, sources: nextSources, views: nextViews });
    },
    [update]
  );

  return useMemo<ImageryController>(
    () => ({
      state,
      campaignBbox,
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
        update({
          ...cur,
          sources: cur.sources.filter((s) => s.id !== id),
          views: cur.views.map((v) => ({
            ...v,
            collectionRefs: v.collectionRefs.filter((r) => r.sourceId !== id),
          })),
        });
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
        patchSource(sourceId, {
          collections: src.collections.filter((c) => c.id !== collectionId),
        });
      },

      refreshCollection: async () => {
        // No-op in draft - collections resolve at campaign-create time.
      },

      addView: async (view) => {
        update({ ...stateRef.current, views: [...stateRef.current.views, view] });
      },

      updateView: async (id, patch) => {
        const cur = stateRef.current;
        update({ ...cur, views: cur.views.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
      },

      removeView: async (id) => {
        const cur = stateRef.current;
        update({ ...cur, views: cur.views.filter((v) => v.id !== id) });
      },

      reorderViews: async (ids) => {
        const cur = stateRef.current;
        const idx = new Map(ids.map((id, i) => [id, i]));
        update({
          ...cur,
          views: [...cur.views].sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0)),
        });
      },

      setBasemaps: async (basemaps) => {
        update({ ...stateRef.current, basemaps });
      },
    }),
    [state, campaignBbox, update, patchSource]
  );
}

function mapCollectionOutToFe(col: ImageryCollectionOut, sourceVizNames: string[]): CollectionItem {
  const sc = col.stac_config;
  const isStacBrowser = !!sc?.catalog_url;

  const vizUrls = col.slices.flatMap((sl) =>
    sl.tile_urls.map((tu) => ({ vizName: tu.visualization_name, url: tu.tile_url }))
  );

  let data: StacBrowserCollectionData | ManualCollectionData;
  if (isStacBrowser && sc) {
    // Backend only stores one viz_params blob per collection (the per-viz tile
    // URLs are on slice rows). Reconstruct one named entry per source viz so
    // a roundtrip-save doesn't trip the backend's name-parity check.
    const namesForViz = sourceVizNames.length > 0 ? sourceVizNames : ['Default'];
    data = {
      type: 'stac_browser',
      catalogUrl: sc.catalog_url ?? '',
      stacCollectionId: sc.stac_collection_id ?? '',
      isMpc: (sc.catalog_url ?? '').includes('planetarycomputer.microsoft.com'),
      mode: 'mosaic',
      maxCloudCover: sc.max_cloud_cover ?? undefined,
      visualizations: sc.viz_params
        ? namesForViz.map((name) => ({
            name,
            vizParams: vizParamsToFrontend(sc.viz_params),
          }))
        : [],
      coverVisualizations: sc.cover_viz_params
        ? namesForViz.map((name) => ({
            name,
            vizParams: vizParamsToFrontend(sc.cover_viz_params),
          }))
        : undefined,
      searchQuery: (sc.search_query as Record<string, unknown>) ?? undefined,
      coverSearchQuery: (sc.cover_search_query as Record<string, unknown>) ?? undefined,
      vizUrls,
    };
  } else {
    data = { type: 'manual', vizUrls };
  }

  return {
    id: String(col.id),
    name: col.name,
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
    collections: src.collections.map((col) => mapCollectionOutToFe(col, vizNames)),
  };
}

function mapViewOutToFe(view: ImageryViewOut): ImageryView {
  return {
    id: String(view.id),
    name: view.name,
    collectionRefs: view.collection_refs.map((ref) => ({
      collectionId: String(ref.collection_id),
      sourceId: String(ref.source_id),
      showAsWindow: ref.show_as_window ?? true,
    })),
  };
}

/** Serialize the local editor state into the upsert payload. Existing
 *  entities pass their real numeric IDs through; freshly-added entities omit
 *  `id` (server treats as create). View refs to new entities are rewritten to
 *  positional keys (`"<src_idx>"`, `"<src_idx>:<col_idx>"`) so the backend can
 *  resolve them after creating the corresponding rows. */
function stateToEditorPayload(state: ImageryStepState): ImageryEditorStateCreate {
  const tempToPosKey = new Map<string, string>();
  state.sources.forEach((src, si) => {
    if (!isRealId(src.id)) tempToPosKey.set(src.id, String(si));
    src.collections.forEach((col, ci) => {
      if (!isRealId(col.id)) tempToPosKey.set(col.id, `${si}:${ci}`);
    });
  });
  const mapRefId = (id: string): string => tempToPosKey.get(id) ?? id;

  return {
    sources: state.sources.map(sourceToBackend),
    views: state.views.map((v) => ({
      id: isRealId(v.id) ? Number(v.id) : undefined,
      name: v.name,
      collection_refs: v.collectionRefs.map((r) => ({
        collection_id: mapRefId(r.collectionId),
        source_id: mapRefId(r.sourceId),
        show_as_window: r.showAsWindow,
      })),
    })),
    basemaps: state.basemaps.map(basemapToBackend),
  };
}

export interface PersistedControllerOptions {
  campaignId: number;
  imagery: ImagerySourceOut[];
  views: ImageryViewOut[];
  basemaps?: { id?: number; name: string; url: string; max_native_zoom?: number | null }[];
  campaignBbox?: number[] | null;
  /** Called after any mutation succeeds so the parent can refetch. */
  refetch?: () => void;
}

/** Deep-equal for plain JSON-shaped state (no functions, no class instances).
 *  Key order is stable because we always build objects via the same literals. */
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function usePersistedController({
  campaignId,
  imagery,
  views,
  basemaps,
  campaignBbox = null,
  refetch,
}: PersistedControllerOptions): ImageryController {
  const initialState = useMemo<ImageryStepState>(
    () => ({
      sources: imagery.map(mapSourceOutToFe),
      views: views.map(mapViewOutToFe),
      basemaps: (basemaps ?? []).map((b, i) => ({
        id: b.id !== undefined ? String(b.id) : `local-${i}`,
        name: b.name,
        url: b.url,
        maxNativeZoom: b.max_native_zoom ?? undefined,
      })),
    }),
    [imagery, views, basemaps]
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
      mode: 'persisted',
      pending,
      isDirty,
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
        mutate((s) => ({
          ...s,
          sources: s.sources.filter((src) => src.id !== id),
          views: s.views.map((v) => ({
            ...v,
            collectionRefs: v.collectionRefs.filter((r) => r.sourceId !== id),
          })),
        }));
      },

      addCollection: async (sourceId, collection) => {
        mutate((s) => ({
          ...s,
          sources: s.sources.map((src) =>
            src.id === sourceId ? { ...src, collections: [...src.collections, collection] } : src
          ),
          // Auto-attach the new collection to any view that already shows this
          // source - otherwise the View Layout tab wouldn't list the new
          // collection until the user manually toggled it in.
          views: s.views.map((v) =>
            v.collectionRefs.some((r) => r.sourceId === sourceId)
              ? {
                  ...v,
                  collectionRefs: [
                    ...v.collectionRefs,
                    { collectionId: collection.id, sourceId, showAsWindow: true },
                  ],
                }
              : v
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
            src.id === sourceId
              ? { ...src, collections: src.collections.filter((c) => c.id !== collectionId) }
              : src
          ),
          views: s.views.map((v) => ({
            ...v,
            collectionRefs: v.collectionRefs.filter((r) => r.collectionId !== collectionId),
          })),
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

      addView: async (view) => {
        mutate((s) => ({ ...s, views: [...s.views, view] }));
      },

      updateView: async (id, patch) => {
        mutate((s) => ({
          ...s,
          views: s.views.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        }));
      },

      removeView: async (id) => {
        mutate((s) => ({ ...s, views: s.views.filter((v) => v.id !== id) }));
      },

      reorderViews: async (ids) => {
        mutate((s) => {
          const idx = new Map(ids.map((id, i) => [id, i]));
          return {
            ...s,
            views: [...s.views].sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0)),
          };
        });
      },

      setBasemaps: async (basemaps) => {
        mutate((s) => ({ ...s, basemaps }));
      },
    }),
    [state, campaignBbox, pending, isDirty, save, discard, mutate, campaignId, refetch]
  );
}
