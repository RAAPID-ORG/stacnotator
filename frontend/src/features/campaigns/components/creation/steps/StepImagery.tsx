import { useState, useRef, useEffect } from 'react';
import type { CampaignCreate } from '~/api/client';
import type {
  ImageryStepState,
  ImagerySource,
  ImageryView,
  Basemap,
  ViewCollectionRef,
  CollectionItem,
  VizParams,
} from './imagery/types';
import { emptySource, emptyView, emptyBasemap, swap, DEFAULT_BASEMAPS } from './imagery/types';
import { CatalogBrowser, MPC_PRESETS } from './imagery/CatalogBrowser';
import type { CatalogBrowserPreset } from './imagery/CatalogBrowser';
import { ImagerySourceEditor } from './imagery/ImagerySourceEditor';
import { CanvasPreview } from './imagery/CanvasPreview';
import { IconTrash, IconPlus, IconSettings, IconStac } from '~/shared/ui/Icons';
import { Modal } from '~/shared/ui/Modal';

export const createInitialImageryState = (): ImageryStepState => {
  const initialView = emptyView();
  initialView.name = 'View 1';
  return {
    sources: [],
    views: [initialView],
    basemaps: [...DEFAULT_BASEMAPS],
  };
};

export const StepImagery = ({
  form,
  setForm,
  imageryState,
  setImageryState,
}: {
  form: CampaignCreate;
  setForm: (f: CampaignCreate) => void;
  imageryState: ImageryStepState;
  setImageryState: (s: ImageryStepState) => void;
}) => {
  const state = imageryState;
  const setState = setImageryState;

  /** Which source is currently being edited (panel open), or null */
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  /** Which view tab is active -starts on the initial view */
  const [activeViewId, setActiveViewId] = useState<string | null>(() => state.views[0]?.id ?? null);
  /** Whether the + Source picker is open */
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  /** Preset currently driving the top-level CatalogBrowser modal, or null. */
  const [presetBrowser, setPresetBrowser] = useState<CatalogBrowserPreset | null>(null);

  const updateState = (next: ImageryStepState) => {
    setState(next);
    syncToForm(next);
  };

  const toVizParamsPayload = (v: VizParams) => ({
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

  const syncToForm = (s: ImageryStepState) => {
    const sources = s.sources.map((src) => ({
      name: src.name,
      crosshair_hex6: src.crosshairHex6,
      default_zoom: src.defaultZoom,
      visualizations: src.visualizations.map((v) => ({ name: v.name })),
      collections: src.collections.map((col) => ({
        name: col.name,
        cover_slice_index: col.coverSliceIndex,
        slices: col.slices.map((sl) => ({
          name: sl.name || undefined,
          start_date: sl.startDate,
          end_date: sl.endDate,
          tile_urls:
            col.data.type === 'stac_browser'
              ? [] // URLs resolved at registration time from viz_params
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
      })),
    }));

    const views = s.views.map((v) => ({
      name: v.name,
      collection_refs: v.collectionRefs
        .map((ref) => {
          const srcIdx = s.sources.findIndex((src) => src.id === ref.sourceId);
          if (srcIdx === -1) return null;
          const colIdx = s.sources[srcIdx].collections.findIndex((c) => c.id === ref.collectionId);
          if (colIdx === -1) return null;
          return {
            collection_id: String(colIdx),
            source_id: String(srcIdx),
            show_as_window: ref.showAsWindow,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    }));

    const basemaps = s.basemaps.map((b) => ({ name: b.name, url: b.url }));

    setForm({
      ...form,
      imagery_editor_state: sources.length > 0 ? { sources, views, basemaps } : null,
    });
  };

  const addSource = () => {
    const src = emptySource();
    updateState({ ...state, sources: [...state.sources, src] });
    setEditingSourceId(src.id);
    setShowSourcePicker(false);
  };

  // Preset flow: open the CatalogBrowser standalone. The source is only created
  // once generation succeeds, so cancelling leaves no empty source behind.
  const addSourceFromPreset = (preset: CatalogBrowserPreset) => {
    setPresetBrowser(preset);
    setShowSourcePicker(false);
  };

  const handlePresetAdd = (collections: CollectionItem[]) => {
    if (!presetBrowser || collections.length === 0) {
      setPresetBrowser(null);
      return;
    }
    const firstCol = collections[0];
    const vizNames =
      firstCol.data.type === 'stac_browser' && firstCol.data.visualizations
        ? firstCol.data.visualizations.map((v) => ({ name: v.name }))
        : [{ name: 'True Color' }];

    const src = emptySource();
    src.name = presetBrowser.label;
    src.visualizations = vizNames;
    src.collections = collections;

    updateState({ ...state, sources: [...state.sources, src] });
    setEditingSourceId(src.id);
    setPresetBrowser(null);
  };

  const updateSource = (id: string, updates: Partial<ImagerySource>) => {
    const nextSources = state.sources.map((s) => (s.id === id ? { ...s, ...updates } : s));
    let nextViews = state.views;

    // When collections change, keep view refs in sync
    if (updates.collections) {
      const oldSource = state.sources.find((s) => s.id === id);
      const oldCollectionIds = new Set(oldSource?.collections.map((c) => c.id) ?? []);
      const newCollectionIds = new Set(updates.collections.map((c) => c.id));

      // Find truly new collections (IDs that didn't exist before)
      const addedIds = updates.collections
        .filter((c) => !oldCollectionIds.has(c.id))
        .map((c) => c.id);
      // Find removed collection IDs
      const removedIds = [...oldCollectionIds].filter((cid) => !newCollectionIds.has(cid));

      if (addedIds.length > 0 || removedIds.length > 0) {
        nextViews = state.views.map((v) => {
          let refs = v.collectionRefs;

          // Remove orphaned refs
          if (removedIds.length > 0) {
            refs = refs.filter((r) => r.sourceId !== id || !removedIds.includes(r.collectionId));
          }

          // Auto-add new collections to views that already reference this source
          if (addedIds.length > 0 && refs.some((r) => r.sourceId === id)) {
            const newRefs = addedIds.map((cid) => ({
              collectionId: cid,
              sourceId: id,
              showAsWindow: true,
            }));
            refs = [...refs, ...newRefs];
          }

          return refs !== v.collectionRefs ? { ...v, collectionRefs: refs } : v;
        });
      }
    }

    updateState({ ...state, sources: nextSources, views: nextViews });
  };

  const removeSource = (id: string) => {
    const nextViews = state.views.map((v) => ({
      ...v,
      collectionRefs: v.collectionRefs.filter((r) => r.sourceId !== id),
    }));
    updateState({
      ...state,
      sources: state.sources.filter((s) => s.id !== id),
      views: nextViews,
    });
    if (editingSourceId === id) setEditingSourceId(null);
  };

  const addView = () => {
    const v = emptyView();
    v.name = `View ${state.views.length + 1}`;
    updateState({ ...state, views: [...state.views, v] });
    setActiveViewId(v.id);
  };

  const updateView = (id: string, updates: Partial<ImageryView>) => {
    updateState({
      ...state,
      views: state.views.map((v) => (v.id === id ? { ...v, ...updates } : v)),
    });
  };

  const removeView = (id: string) => {
    const next = state.views.filter((v) => v.id !== id);
    updateState({ ...state, views: next });
    if (activeViewId === id) setActiveViewId(next[0]?.id ?? null);
  };

  const moveView = (id: string, direction: -1 | 1) => {
    const index = state.views.findIndex((v) => v.id === id);
    if (index < 0) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= state.views.length) return;
    updateState({ ...state, views: swap(state.views, index, newIndex) });
  };

  /** Toggle a source's assignment to the active view.
   *  When adding: all its collections become visible (showAsWindow=true).
   *  When removing: all its collectionRefs are removed. */
  const toggleSourceInView = (sourceId: string) => {
    const view = state.views.find((v) => v.id === activeViewId);
    if (!view) return;
    const source = state.sources.find((s) => s.id === sourceId);
    if (!source) return;

    const isAssigned = view.collectionRefs.some((r) => r.sourceId === sourceId);
    if (isAssigned) {
      // Remove all refs for this source
      updateView(view.id, {
        collectionRefs: view.collectionRefs.filter((r) => r.sourceId !== sourceId),
      });
    } else {
      // Add all collections from this source
      const newRefs: ViewCollectionRef[] = source.collections.map((c) => ({
        collectionId: c.id,
        sourceId,
        showAsWindow: true,
      }));
      updateView(view.id, {
        collectionRefs: [...view.collectionRefs, ...newRefs],
      });
    }
  };

  // Basemap helpers
  const updateBasemaps = (basemaps: Basemap[]) => updateState({ ...state, basemaps });
  const addBasemap = () => updateBasemaps([...state.basemaps, emptyBasemap()]);
  const removeBasemap = (id: string) => updateBasemaps(state.basemaps.filter((b) => b.id !== id));
  const updateBasemap = (id: string, updates: Partial<Basemap>) =>
    updateBasemaps(state.basemaps.map((b) => (b.id === id ? { ...b, ...updates } : b)));

  const editingSource = state.sources.find((s) => s.id === editingSourceId) ?? null;

  /* Compute which sources are not assigned to ANY view */
  const allAssignedSourceIds = new Set(
    state.views.flatMap((v) => v.collectionRefs.map((r) => r.sourceId))
  );
  const sourcesNotInAnyView = new Set(
    state.sources.filter((s) => !allAssignedSourceIds.has(s.id)).map((s) => s.id)
  );

  /* Refs for speech-bubble positioning */
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /* Track the last-edited source so we can animate close smoothly */
  const [renderedSource, setRenderedSource] = useState<ImagerySource | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingSource) {
      setRenderedSource(editingSource);
      // Trigger open animation next frame
      requestAnimationFrame(() => requestAnimationFrame(() => setEditorVisible(true)));
    } else if (renderedSource) {
      // Start close animation
      setEditorVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSource?.id]);

  // Keep rendered source in sync when it changes while open
  useEffect(() => {
    if (editingSource) setRenderedSource(editingSource);
  }, [editingSource]);

  const handleEditorTransitionEnd = () => {
    if (!editorVisible && !editingSource) {
      setRenderedSource(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Imagery Sources */}
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-neutral-900">Imagery Sources</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Define where imagery comes from, the temporal intervals available, and how it should be
            visualized. Each source represents a dataset (e.g. Sentinel-2, Landsat, NAIP) with
            collections that cover specific time periods.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 relative">
          {state.sources.map((source, _index) => {
            const isEditing = editingSourceId === source.id;
            const notInAnyView = sourcesNotInAnyView.has(source.id);

            return (
              <div key={source.id} className="shrink-0 flex flex-col items-center gap-1">
                <button
                  ref={(el) => {
                    tileRefs.current[source.id] = el;
                  }}
                  type="button"
                  onClick={() => setEditingSourceId(isEditing ? null : source.id)}
                  title="Click to configure"
                  className={`group relative flex items-center justify-center rounded-lg border-2 transition-all cursor-pointer
                    px-4 py-3 shrink-0
                    ${
                      isEditing
                        ? 'border-brand-600 bg-brand-50 text-brand-700 shadow-md'
                        : notInAnyView
                          ? 'border-red-300 bg-red-50/40 text-neutral-800 hover:border-red-400 hover:bg-red-50'
                          : 'border-neutral-200 bg-white text-neutral-800 hover:border-brand-400 hover:bg-brand-700/10'
                    }`}
                >
                  {notInAnyView && !isEditing && (
                    <span
                      className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white leading-none"
                      title="Not added to any view"
                    >
                      !
                    </span>
                  )}
                  <IconSettings
                    className={`absolute inset-0 m-auto w-4 h-4 transition-opacity ${
                      isEditing ? 'opacity-0' : 'opacity-0 group-hover:opacity-100 text-brand-600'
                    }`}
                  />
                  <span
                    className={`text-xs font-medium leading-tight truncate max-w-[120px] transition-opacity ${
                      isEditing ? 'opacity-100' : 'group-hover:opacity-0'
                    }`}
                  >
                    {source.name || 'Untitled'}
                  </span>
                </button>
                {notInAnyView && (
                  <span className="text-[9px] text-red-500 font-medium leading-none">
                    Not in any view
                  </span>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setShowSourcePicker(true)}
            className="flex items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 hover:border-brand-400 hover:bg-brand-50/30 transition-all cursor-pointer px-4 py-3 shrink-0"
          >
            <IconPlus className="w-4 h-4 text-neutral-400" />
            <span className="text-[11px] text-neutral-500 ml-1">Create Source</span>
          </button>
        </div>

        {renderedSource && (
          <div
            ref={editorRef}
            className="relative !mt-0 pt-3 overflow-hidden transition-all duration-300 ease-in-out"
            style={{
              maxHeight: editorVisible ? '2000px' : '0px',
              opacity: editorVisible ? 1 : 0,
              paddingTop: editorVisible ? undefined : '0px',
            }}
            onTransitionEnd={handleEditorTransitionEnd}
          >
            <div
              className="absolute left-0 right-0 flex z-10"
              style={{ pointerEvents: 'none', top: 0 }}
            >
              {(() => {
                const sourceForTriangle = editingSource ?? renderedSource;
                const tileEl = tileRefs.current[sourceForTriangle.id];
                const parentEl = tileEl?.parentElement;
                if (tileEl && parentEl) {
                  const tileRect = tileEl.getBoundingClientRect();
                  const parentRect = parentEl.getBoundingClientRect();
                  const offset = tileRect.left - parentRect.left + tileRect.width / 2;
                  return (
                    <div style={{ marginLeft: offset - 12 }}>
                      <svg width="24" height="14" viewBox="0 0 24 14" fill="none">
                        <path d="M12 0L24 14H0L12 0Z" fill="rgb(65 120 93)" />
                      </svg>
                    </div>
                  );
                }
                return (
                  <div style={{ marginLeft: 40 }}>
                    <svg width="24" height="14" viewBox="0 0 24 14" fill="none">
                      <path d="M12 0L24 14H0L12 0Z" fill="rgb(65 120 93)" />
                    </svg>
                  </div>
                );
              })()}
            </div>

            <div className="rounded-lg border-2 border-brand-600 bg-white shadow-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-brand-600 text-white">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <IconSettings className="w-4 h-4 text-white/80 shrink-0" />
                  <input
                    type="text"
                    value={renderedSource.name}
                    onChange={(e) => updateSource(renderedSource.id, { name: e.target.value })}
                    placeholder="Source name…"
                    className="bg-transparent border-0 border-b border-white/30 focus:border-white outline-none text-sm font-medium text-white placeholder-white/40 py-0 px-0 min-w-0 flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => removeSource(renderedSource.id)}
                    className="text-white/60 hover:text-white transition-colors cursor-pointer p-1"
                    title="Delete source"
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSourceId(null)}
                    className="text-white/60 hover:text-white transition-colors cursor-pointer text-xs px-2 py-0.5 rounded hover:bg-white/10"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="p-4">
                <ImagerySourceEditor
                  source={renderedSource}
                  onChange={(updates) => updateSource(renderedSource.id, updates)}
                  onRemove={() => removeSource(renderedSource.id)}
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Section 2: View Layout */}
      {state.sources.length > 0 && (
        <section>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-neutral-900">View Layout</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Configure how imagery appears in the annotation tool. Arrange sources into views
              (tabs) and choose which collections are visible as map windows.
            </p>
            <p className="text-xs text-neutral-500 mt-0.5">
              When you add a source, all its collections become available as windows in the active
              view. You can then toggle individual windows on/off from the canvas. These collections
              are then still reachable through explicit layer selection in the main (large) map,
              however they do not get a dedicated (small) preview window.
            </p>
          </div>
          <CanvasPreview
            sources={state.sources}
            views={state.views}
            basemaps={state.basemaps}
            activeViewId={activeViewId}
            onActiveViewChange={setActiveViewId}
            onAddView={addView}
            onUpdateView={updateView}
            onRemoveView={removeView}
            onMoveView={moveView}
            onToggleSourceInView={toggleSourceInView}
            onAddSource={() => setShowSourcePicker(true)}
            sourcesNotInAnyView={sourcesNotInAnyView}
          />
        </section>
      )}

      {showSourcePicker && (
        <Modal title="Create Imagery Source" onClose={() => setShowSourcePicker(false)}>
          <div className="p-3 space-y-1">
            <p className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold px-4 pt-1 pb-0.5">
              STAC Presets
            </p>
            {MPC_PRESETS.map((preset) => (
              <button
                key={preset.stacCollectionId}
                type="button"
                onClick={() => addSourceFromPreset(preset)}
                className="w-full text-left px-4 py-2.5 rounded-lg bg-brand-50/50 border border-brand-100 hover:bg-brand-100 cursor-pointer transition-colors"
              >
                <span className="text-sm font-medium text-brand-700 flex items-center gap-1.5">
                  <IconStac className="w-3.5 h-3.5 text-brand-700" />
                  {preset.label}
                  <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold ml-auto">
                    MPC
                  </span>
                </span>
              </button>
            ))}
            <div className="border-t border-neutral-100 my-1.5" />
            <button
              type="button"
              onClick={addSource}
              className="w-full text-left px-4 py-2.5 rounded-lg hover:bg-neutral-50 cursor-pointer transition-colors"
            >
              <span className="text-sm font-medium text-neutral-800">Manual</span>
              <p className="text-xs text-neutral-500 mt-0.5">
                Start from scratch with an empty source configuration.
              </p>
            </button>
          </div>
        </Modal>
      )}

      {/* Section 3: Basemaps - simple list, one row per entry. Name + URL
          sit side by side as standard inputs; delete is a quiet X at the end.
          No nested cards, no pills. */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">Basemaps</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Background reference layers shown beneath imagery in every view.
            </p>
          </div>
          <button
            type="button"
            onClick={addBasemap}
            className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            + Add basemap
          </button>
        </div>

        {state.basemaps.length === 0 ? (
          <p className="text-xs text-neutral-400 italic">No basemaps configured.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
            {state.basemaps.map((bm) => (
              <li key={bm.id} className="flex items-center gap-3 py-2">
                <input
                  type="text"
                  value={bm.name}
                  onChange={(e) => updateBasemap(bm.id, { name: e.target.value })}
                  placeholder="Name"
                  className="w-40 h-8 px-2.5 text-xs border border-neutral-300 rounded-md bg-white focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition-colors"
                />
                <input
                  type="text"
                  value={bm.url}
                  onChange={(e) => updateBasemap(bm.id, { url: e.target.value })}
                  placeholder="https://.../{z}/{x}/{y}.png"
                  className="flex-1 h-8 px-2.5 text-[11px] font-mono text-neutral-700 border border-neutral-300 rounded-md bg-white focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => removeBasemap(bm.id)}
                  className="text-neutral-400 hover:text-red-600 transition-colors cursor-pointer p-1 shrink-0"
                  aria-label="Remove basemap"
                  title="Remove basemap"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {presetBrowser && (
        <CatalogBrowser
          initialMode="mosaic"
          preset={presetBrowser}
          onAdd={handlePresetAdd}
          onClose={() => setPresetBrowser(null)}
        />
      )}
    </div>
  );
};
