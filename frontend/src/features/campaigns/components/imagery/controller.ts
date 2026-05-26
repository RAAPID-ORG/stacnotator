import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  updateSource as apiUpdateSource,
  deleteSource as apiDeleteSource,
  updateCollection as apiUpdateCollection,
  updateVizParams as apiUpdateVizParams,
  updateTileUrls as apiUpdateTileUrls,
  refreshCollectionImagery as apiRefreshCollection,
  addView as apiAddView,
  updateView as apiUpdateView,
  deleteView as apiDeleteView,
  reorderViews as apiReorderViews,
} from '~/api/client';
import type {
  ImagerySourceOut,
  ImageryCollectionOut,
  ImageryViewOut,
  ViewCollectionRefItem,
} from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import type {
  Basemap,
  CollectionItem,
  ImagerySource,
  ImageryStepState,
  ImageryView,
  ManualCollectionData,
  StacBrowserCollectionData,
  StacCollectionData,
  VizParams,
} from './types';

export type ControllerMode = 'draft' | 'persisted';

export interface ImageryController {
  readonly state: ImageryStepState;
  readonly campaignBbox: number[] | null;
  readonly mode: ControllerMode;
  readonly pending: boolean;

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
  // Read freshest state on writes — without this, queued setState calls
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
        // No-op in draft — collections resolve at campaign-create time.
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

function mapCollectionOutToFe(col: ImageryCollectionOut): CollectionItem {
  const sc = col.stac_config;
  const isStacBrowser = !!sc?.catalog_url;
  const isStac = !!sc && !isStacBrowser;

  const vizUrls = col.slices.flatMap((sl) =>
    sl.tile_urls.map((tu) => ({ vizName: tu.visualization_name, url: tu.tile_url }))
  );

  let data: StacBrowserCollectionData | StacCollectionData | ManualCollectionData;
  if (isStacBrowser && sc) {
    data = {
      type: 'stac_browser',
      catalogUrl: sc.catalog_url ?? '',
      stacCollectionId: sc.stac_collection_id ?? '',
      isMpc: (sc.catalog_url ?? '').includes('planetarycomputer.microsoft.com'),
      mode: 'mosaic',
      maxCloudCover: sc.max_cloud_cover ?? undefined,
      visualizations: sc.viz_params
        ? [{ name: 'Default', vizParams: vizParamsToFrontend(sc.viz_params) }]
        : [],
      coverVisualizations: sc.cover_viz_params
        ? [{ name: 'Default', vizParams: vizParamsToFrontend(sc.cover_viz_params) }]
        : undefined,
      searchQuery: (sc.search_query as Record<string, unknown>) ?? undefined,
      coverSearchQuery: (sc.cover_search_query as Record<string, unknown>) ?? undefined,
      vizUrls,
    };
  } else if (isStac && sc) {
    data = {
      type: 'stac',
      registrationUrl: sc.registration_url,
      searchBody: sc.search_body,
      vizUrls,
    };
  } else {
    data = { type: 'manual', vizUrls };
  }

  return {
    id: String(col.id),
    name: col.name,
    coverSliceIndex: col.cover_slice_index ?? 0,
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
  return {
    id: String(src.id),
    name: src.name,
    crosshairHex6: src.crosshair_hex6,
    defaultZoom: src.default_zoom,
    visualizations: src.visualizations.map((v) => ({ name: v.name })),
    collections: src.collections.map(mapCollectionOutToFe),
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

function refsToBackend(refs: ImageryView['collectionRefs']): ViewCollectionRefItem[] {
  return refs.map((ref) => ({
    collection_id: Number(ref.collectionId),
    source_id: Number(ref.sourceId),
    show_as_window: ref.showAsWindow,
  }));
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
  useEffect(() => setState(initialState), [initialState]);

  const [pendingCount, setPendingCount] = useState(0);
  const runMutation = useCallback(
    async (label: string, mutator: () => Promise<unknown>, applyLocal: () => void) => {
      setPendingCount((c) => c + 1);
      try {
        applyLocal();
        await mutator();
        refetch?.();
      } catch (e) {
        handleError(e, label);
        setState(initialState); // roll local mirror back to server truth
        throw e;
      } finally {
        setPendingCount((c) => c - 1);
      }
    },
    [refetch, initialState]
  );

  return useMemo<ImageryController>(
    () => ({
      state,
      campaignBbox,
      mode: 'persisted',
      pending: pendingCount > 0,

      addSource: async (source) => {
        await runMutation(
          'Cannot add source',
          async () => {
            // Backend gap — no per-source POST endpoint yet. Optimistic update
            // is rolled back by runMutation when this throws.
            throw new Error(
              'Adding a new imagery source to an existing campaign needs a backend endpoint that is not implemented yet.'
            );
          },
          () => setState((s) => ({ ...s, sources: [...s.sources, source] }))
        );
      },

      updateSource: async (id, patch) => {
        const body: Record<string, unknown> = {};
        if (patch.name !== undefined) body.name = patch.name;
        if (patch.crosshairHex6 !== undefined) body.crosshair_hex6 = patch.crosshairHex6;
        if (patch.defaultZoom !== undefined) body.default_zoom = patch.defaultZoom;
        if (patch.visualizations !== undefined) {
          body.visualizations = patch.visualizations.map((v) => ({ name: v.name }));
        }
        await runMutation(
          'Failed to update imagery source',
          async () => {
            if (Object.keys(body).length > 0) {
              await apiUpdateSource({
                path: { campaign_id: campaignId, source_id: Number(id) },
                body: body as never,
              });
            }
          },
          () =>
            setState((s) => ({
              ...s,
              sources: s.sources.map((src) => (src.id === id ? { ...src, ...patch } : src)),
            }))
        );
      },

      removeSource: async (id) => {
        await runMutation(
          'Failed to delete imagery source',
          async () => {
            await apiDeleteSource({ path: { campaign_id: campaignId, source_id: Number(id) } });
          },
          () =>
            setState((s) => ({
              ...s,
              sources: s.sources.filter((src) => src.id !== id),
              views: s.views.map((v) => ({
                ...v,
                collectionRefs: v.collectionRefs.filter((r) => r.sourceId !== id),
              })),
            }))
        );
      },

      addCollection: async (sourceId, collection) => {
        await runMutation(
          'Cannot add collection',
          async () => {
            throw new Error(
              'Adding a new collection to a saved source needs a backend endpoint that is not implemented yet.'
            );
          },
          () =>
            setState((s) => ({
              ...s,
              sources: s.sources.map((src) =>
                src.id === sourceId
                  ? { ...src, collections: [...src.collections, collection] }
                  : src
              ),
            }))
        );
      },

      updateCollection: async (sourceId, collectionId, patch) => {
        const cid = Number(collectionId);
        const metaBody: Record<string, unknown> = {};
        if (patch.name !== undefined) metaBody.name = patch.name;
        if (patch.coverSliceIndex !== undefined) metaBody.cover_slice_index = patch.coverSliceIndex;

        const calls: Array<() => Promise<unknown>> = [];
        if (Object.keys(metaBody).length > 0) {
          calls.push(() =>
            apiUpdateCollection({
              path: { campaign_id: campaignId, collection_id: cid },
              body: metaBody as never,
            })
          );
        }
        if (patch.data?.type === 'stac_browser') {
          const data = patch.data;
          calls.push(() =>
            apiUpdateVizParams({
              path: { campaign_id: campaignId, collection_id: cid },
              body: {
                visualizations: (data.visualizations ?? []).map((v) => {
                  const cover = data.coverVisualizations?.find((cv) => cv.name === v.name);
                  return {
                    name: v.name,
                    viz_params: vizParamsToBackend(v.vizParams),
                    cover_viz_params: cover ? vizParamsToBackend(cover.vizParams) : undefined,
                  };
                }),
                max_cloud_cover: data.maxCloudCover ?? null,
                search_query: data.searchQuery ?? null,
                cover_search_query: data.coverSearchQuery ?? null,
              } as never,
            })
          );
        }
        if (patch.data?.type === 'manual' && patch.slices) {
          calls.push(() =>
            apiUpdateTileUrls({
              path: { campaign_id: campaignId, collection_id: cid },
              body: {
                slices: patch.slices!.map((sl, i) => ({
                  slice_index: i,
                  tile_urls: (sl.vizUrls ?? []).map((vu) => ({
                    visualization_name: vu.vizName,
                    tile_url: vu.url,
                  })),
                })),
              } as never,
            })
          );
        }

        await runMutation(
          'Failed to update collection',
          async () => {
            for (const call of calls) await call();
          },
          () =>
            setState((s) => ({
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
            }))
        );
      },

      removeCollection: async (sourceId, collectionId) => {
        await runMutation(
          'Cannot remove collection',
          async () => {
            throw new Error(
              'Removing a collection from a saved source needs a backend endpoint that is not implemented yet.'
            );
          },
          () =>
            setState((s) => ({
              ...s,
              sources: s.sources.map((src) =>
                src.id === sourceId
                  ? { ...src, collections: src.collections.filter((c) => c.id !== collectionId) }
                  : src
              ),
            }))
        );
      },

      refreshCollection: async (_sourceId, collectionId) => {
        await runMutation(
          'Failed to refresh collection',
          async () => {
            await apiRefreshCollection({
              path: { campaign_id: campaignId, collection_id: Number(collectionId) },
            });
          },
          () => {}
        );
      },

      addView: async (view) => {
        await runMutation(
          'Failed to add view',
          () =>
            apiAddView({
              path: { campaign_id: campaignId },
              body: {
                name: view.name,
                collection_refs: refsToBackend(view.collectionRefs),
              } as never,
            }),
          () => setState((s) => ({ ...s, views: [...s.views, view] }))
        );
      },

      updateView: async (id, patch) => {
        const body: Record<string, unknown> = {};
        if (patch.name !== undefined) body.name = patch.name;
        if (patch.collectionRefs !== undefined) {
          body.collection_refs = refsToBackend(patch.collectionRefs);
        }
        await runMutation(
          'Failed to update view',
          async () => {
            if (Object.keys(body).length > 0) {
              await apiUpdateView({
                path: { campaign_id: campaignId, view_id: Number(id) },
                body: body as never,
              });
            }
          },
          () =>
            setState((s) => ({
              ...s,
              views: s.views.map((v) => (v.id === id ? { ...v, ...patch } : v)),
            }))
        );
      },

      removeView: async (id) => {
        await runMutation(
          'Failed to delete view',
          async () => {
            await apiDeleteView({ path: { campaign_id: campaignId, view_id: Number(id) } });
          },
          () => setState((s) => ({ ...s, views: s.views.filter((v) => v.id !== id) }))
        );
      },

      reorderViews: async (ids) => {
        await runMutation(
          'Failed to reorder views',
          () =>
            apiReorderViews({
              path: { campaign_id: campaignId },
              body: { view_ids: ids.map(Number) } as never,
            }),
          () => {
            const idx = new Map(ids.map((id, i) => [id, i]));
            setState((s) => ({
              ...s,
              views: [...s.views].sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0)),
            }));
          }
        );
      },

      setBasemaps: async (basemaps) => {
        await runMutation(
          'Cannot save basemaps',
          async () => {
            throw new Error(
              'Editing basemaps after campaign creation needs a backend endpoint that is not implemented yet.'
            );
          },
          () => setState((s) => ({ ...s, basemaps }))
        );
      },
    }),
    [state, campaignBbox, pendingCount, runMutation, campaignId]
  );
}
