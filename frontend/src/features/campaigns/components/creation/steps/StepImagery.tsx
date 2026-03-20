import { useState, useRef, useEffect } from 'react';
import type { CampaignCreate } from '~/api/client';
import type { ImageryStepState, ImagerySource, ImageryView, Basemap, ViewCollectionRef } from './imagery/types';
import { emptySource, emptyView, emptyBasemap, swap, DEFAULT_BASEMAPS, STAC_PRESETS } from './imagery/types';
import { ImagerySourceEditor } from './imagery/ImagerySourceEditor';
import { CanvasPreview } from './imagery/CanvasPreview';
import { IconTrash, IconPlus, IconSettings, IconChevronDown, IconChevronUp, IconStac } from '~/shared/ui/Icons';
import { Modal } from '~/shared/ui/Modal';
import { Tooltip } from './imagery/Tooltip';

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
  const [activeViewId, setActiveViewId] = useState<string | null>(
    () => state.views[0]?.id ?? null,
  );
  /** Whether the intro guide is expanded */
  const [showGuide, setShowGuide] = useState(true);
  /** Whether the + Source picker is open */
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  /** When a preset source is created, pass the preset ID so StacGenerator opens automatically */
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null);

  const updateState = (next: ImageryStepState) => {
    setState(next);
    syncToForm(next);
  };

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
          tile_urls: col.data.vizUrls
            .filter((v) => v.url)
            .map((v) => ({ visualization_name: v.vizName, tile_url: v.url })),
        })),
        stac_config: col.data.type === 'stac' && col.data.registrationUrl
          ? { registration_url: col.data.registrationUrl, search_body: col.data.searchBody }
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
    setPendingPresetId(null);
  };

  const addSourceFromPreset = (presetId: string) => {
    const preset = STAC_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const src = emptySource();
    src.name = preset.label;
    // Set visualizations from preset viz URLs
    src.visualizations = preset.config.vizUrls.map((v) => ({ name: v.vizName }));
    updateState({ ...state, sources: [...state.sources, src] });
    setEditingSourceId(src.id);
    setShowSourcePicker(false);
    setPendingPresetId(presetId);
  };

  const updateSource = (id: string, updates: Partial<ImagerySource>) => {
    updateState({
      ...state,
      sources: state.sources.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    });
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

  const moveView = (index: number, direction: -1 | 1) => {
    updateState({ ...state, views: swap(state.views, index, index + direction) });
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
    state.views.flatMap((v) => v.collectionRefs.map((r) => r.sourceId)),
  );
  const sourcesNotInAnyView = new Set(
    state.sources.filter((s) => !allAssignedSourceIds.has(s.id)).map((s) => s.id),
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
    <div className="space-y-4">
      {/* Guide section */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowGuide(!showGuide)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left cursor-pointer hover:bg-neutral-100/50 transition-colors"
        >
          <span className="text-sm text-neutral-700">
            <span className="font-medium">How imagery configuration works</span>
          </span>
          {showGuide ? <IconChevronUp className="w-4 h-4 text-neutral-400" /> : <IconChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>
        {showGuide && (
          <div className="px-4 pb-3 pt-0 border-t border-neutral-200 text-xs text-neutral-600 space-y-2">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 mt-2">
              <span className="font-semibold text-brand-700 text-right">1. Source</span>
              <span>A data provider (e.g. <em>Sentinel-2</em> or <em>Landsat</em>). Each source has a default zoom, crosshair color, and one or more visualizations that you would like to show (like True Color, NDVI).</span>
              <span className="font-semibold text-brand-700 text-right">2. Collection</span>
              <span>A time window of imagery within a source (e.g. <em>January 2024</em>). STAC collections search data from a catalog that is shown through TiTiler; Manual/XYZ collections use a direct tile URL.</span>
              <span className="font-semibold text-brand-700 text-right">3. Slice</span>
              <span>A sub-period within a collection (e.g. <em>Week 1, Week 2</em>). Annotators can switch between slices to find cloud-free imagery. One slice is marked as the <strong>cover</strong> (default visible). Often you might want to use some form of composite (i.e median) as the cover, and then have weekly slices to see all imagery in detail.</span>
              <span className="font-semibold text-brand-700 text-right">4. View</span>
              <span>A layout tab in the canvas above. Each view can include different sources. Often you might want to have one view per source to not overcrowd the screen. Sources can be part of different views.</span>
              <span className="font-semibold text-brand-700 text-right">5. Window</span>
              <span>Each collection assigned to a view becomes a map window. You always have one main map; The windows appear as small thumbnails. You can hide windows you don't need - they can still be seen through navigation on the timeline (layer selector).</span>
            </div>
            <div className="pt-1.5 border-t border-neutral-100 text-neutral-500 leading-relaxed">
              <strong className="text-neutral-600">Workflow:</strong> Create sources below → configure their collections &amp; slices → add sources to views using the canvas preview above → select windows.
            </div>
          </div>
        )}
      </div>

      <div>
        <CanvasPreview
          sources={state.sources}
          views={state.views}
          basemaps={state.basemaps}
          activeViewId={activeViewId}
          onActiveViewChange={setActiveViewId}
          onAddView={addView}
          onUpdateView={updateView}
          onRemoveView={removeView}
          onToggleSourceInView={toggleSourceInView}
          onAddSource={() => setShowSourcePicker(true)}
          sourcesNotInAnyView={sourcesNotInAnyView}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-neutral-800 uppercase tracking-wide">
            Imagery Sources
          </h3>
        </div>

        <div className="flex flex-wrap gap-2 relative">
          {state.sources.map((source, index) => {
            const isEditing = editingSourceId === source.id;
            const notInAnyView = sourcesNotInAnyView.has(source.id);

            return (
              <div key={source.id} className="shrink-0 flex flex-col items-center gap-1">
                <button
                  ref={(el) => { tileRefs.current[source.id] = el; }}
                  type="button"
                  onClick={() => { setEditingSourceId(isEditing ? null : source.id); setPendingPresetId(null); }}
                  title="Click to configure"
                  className={`group relative flex items-center justify-center rounded-lg border-2 transition-all cursor-pointer
                    px-4 py-3 shrink-0
                    ${isEditing
                      ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-md'
                      : notInAnyView
                        ? 'border-red-300 bg-red-50/40 text-neutral-800 hover:border-red-400 hover:bg-red-50'
                        : 'border-neutral-200 bg-white text-neutral-800 hover:border-brand-400 hover:bg-brand-500/10'
                    }`}
                >
                  {notInAnyView && !isEditing && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white leading-none" title="Not added to any view">
                      !
                    </span>
                  )}
                  <IconSettings className={`absolute inset-0 m-auto w-4 h-4 transition-opacity ${
                    isEditing
                      ? 'opacity-0'
                      : 'opacity-0 group-hover:opacity-100 text-brand-600'
                  }`} />
                  <span className={`text-xs font-medium leading-tight truncate max-w-[120px] transition-opacity ${
                    isEditing ? 'opacity-100' : 'group-hover:opacity-0'
                  }`}>
                    {source.name || 'Untitled'}
                  </span>
                </button>
                {notInAnyView && (
                  <span className="text-[9px] text-red-500 font-medium leading-none">Not in any view</span>
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
      </div>

      {showSourcePicker && (
        <Modal title="Create Imagery Source" onClose={() => setShowSourcePicker(false)}>
            <div className="p-3 space-y-1">
              <p className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold px-4 pt-1 pb-0.5">STAC Presets</p>
              {STAC_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => addSourceFromPreset(preset.id)}
                  className="w-full text-left px-4 py-2.5 rounded-lg bg-brand-50/50 border border-brand-100 hover:bg-brand-100 cursor-pointer transition-colors"
                >
                  <span className="text-sm font-medium text-brand-700 flex items-center gap-1.5">
                    <IconStac className="w-3.5 h-3.5 text-brand-500" />
                    {preset.label}
                  </span>
                </button>
              ))}
              <div className="border-t border-neutral-100 my-1.5" />
              <button
                type="button"
                onClick={addSource}
                className="w-full text-left px-4 py-2.5 rounded-lg hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                <span className="text-sm font-medium text-neutral-800">Manual (empty source)</span>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Start from scratch with an empty source configuration.
                </p>
              </button>
            </div>
        </Modal>
      )}

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
          <div className="absolute left-0 right-0 flex z-10" style={{ pointerEvents: 'none', top: 0 }}>
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

          <div className="rounded-lg border-2 border-brand-500 bg-white shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-brand-500 text-white">
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
                initialPresetId={editingSourceId === renderedSource.id ? pendingPresetId : null}
                onPresetConsumed={() => setPendingPresetId(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Basemaps */}
      <div className="border-t border-neutral-200 pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-neutral-800 uppercase tracking-wide flex items-center gap-1">
            Basemaps
            <Tooltip text="Background reference layers shown in every view (e.g. OpenStreetMap, satellite)." />
          </h4>
          <button
            type="button"
            onClick={addBasemap}
            className="text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
          >
            + Add
          </button>
        </div>

        {state.basemaps.length === 0 ? (
          <p className="text-xs text-neutral-400 italic">No basemaps configured.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {state.basemaps.map((bm) => (
              <div
                key={bm.id}
                className="group flex items-center gap-2 rounded border border-neutral-200 bg-white pl-2.5 pr-1 py-1 text-xs"
              >
                <input
                  type="text"
                  value={bm.name}
                  onChange={(e) => updateBasemap(bm.id, { name: e.target.value })}
                  placeholder="Name"
                  className="w-24 border-0 border-b border-transparent focus:border-brand-500 outline-none text-xs py-0 px-0"
                />
                <input
                  type="text"
                  value={bm.url}
                  onChange={(e) => updateBasemap(bm.id, { url: e.target.value })}
                  placeholder="https://.../{z}/{x}/{y}.png"
                  className="w-56 border-0 border-b border-transparent focus:border-brand-500 outline-none text-[11px] font-mono py-0 px-0 text-neutral-500"
                />
                <button
                  type="button"
                  onClick={() => removeBasemap(bm.id)}
                  className="text-neutral-300 hover:text-red-500 transition-colors cursor-pointer p-0.5 opacity-0 group-hover:opacity-100"
                >
                  <IconTrash className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
