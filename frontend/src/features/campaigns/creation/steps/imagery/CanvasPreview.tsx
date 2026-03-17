import { useState, useCallback, useRef, useEffect } from 'react';
import type { ImagerySource, ImageryView, Basemap, ImagerySlice } from './types';
import { resolveCollection, sliceDateRange } from './types';
import { IconPlus, IconEyeSlash, IconEye, IconTrash, IconLayers } from '~/shared/ui/Icons';

interface CanvasPreviewProps {
  sources: ImagerySource[];
  views: ImageryView[];
  basemaps: Basemap[];
  activeViewId: string | null;
  draggingSourceId: string | null;
  onActiveViewChange: (id: string) => void;
  onAddView: () => void;
  onUpdateView: (id: string, updates: Partial<ImageryView>) => void;
  onRemoveView: (id: string) => void;
  onToggleSourceInView: (sourceId: string) => void;
  onAddSource?: () => void;
  className?: string;
}

type ResolvedWindow = {
  ref: { collectionId: string; sourceId: string; showAsWindow: boolean };
  collection: { id: string; name: string; slices: ImagerySlice[]; coverSliceIndex: number };
  source: ImagerySource;
};

// Native select styling
const selectClass = 'px-2 py-1 bg-white/95 text-neutral-900 text-xs font-medium rounded shadow-sm border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-6 bg-[url(\'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E\')] bg-no-repeat bg-[right_0.35rem_center]';

const selectClassCompact = 'px-1.5 py-0.5 bg-white/95 text-neutral-900 text-[11px] font-medium rounded shadow-sm border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-5 bg-[url(\'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%228%22%20height%3D%228%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E\')] bg-no-repeat bg-[right_0.25rem_center]';

const selectClassTiny = 'px-1 py-0.5 bg-white/95 text-neutral-900 text-[9px] font-medium rounded shadow-sm border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-4 bg-[url(\'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%226%22%20height%3D%226%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E\')] bg-no-repeat bg-[right_0.2rem_center]';

function SmallWindow({
  win,
  index,
  onHide,
}: {
  win: ResolvedWindow;
  index: number;
  onHide?: () => void;
}) {
  const [selectedSliceIndex, setSelectedSliceIndex] = useState(win.collection.coverSliceIndex);

  const collectionLabel = win.collection.name || sliceDateRange(win.collection.slices) || `Window ${index + 1}`;
  const sourceLabel = win.source.name || 'Untitled';
  const crosshair = win.source.crosshairHex6;
  const slices = win.collection.slices;

  return (
    <div className="rounded border border-neutral-200 bg-white overflow-hidden flex flex-col">
      <div className="bg-neutral-50 px-2 py-1 border-b border-neutral-100 flex items-center justify-between gap-1 min-h-[22px]">
        <span className="text-[11px] font-semibold text-neutral-700 truncate leading-none" title={`${collectionLabel} (${sourceLabel})`}>
          {collectionLabel} <span className="font-normal text-neutral-400">({sourceLabel})</span>
        </span>
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="text-neutral-300 hover:text-neutral-500 transition-colors cursor-pointer shrink-0"
            title="Hide from view"
          >
            <IconEyeSlash className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="relative flex-1" style={{ minHeight: 64 }}>
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(to right, #666 1px, transparent 1px), linear-gradient(to bottom, #666 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <line x1="0" y1="8" x2="6" y2="8" stroke={`#${crosshair}`} strokeWidth="0.8" opacity="0.5" />
            <line x1="10" y1="8" x2="16" y2="8" stroke={`#${crosshair}`} strokeWidth="0.8" opacity="0.5" />
            <line x1="8" y1="0" x2="8" y2="6" stroke={`#${crosshair}`} strokeWidth="0.8" opacity="0.5" />
            <line x1="8" y1="10" x2="8" y2="16" stroke={`#${crosshair}`} strokeWidth="0.8" opacity="0.5" />
          </svg>
        </div>
        <div className="absolute bottom-1 left-1 bg-white/85 rounded px-1 py-0.5 flex items-center gap-0.5">
          <div className="w-5 h-px bg-neutral-600" />
          <span className="text-[9px] text-neutral-600 leading-none">100 m</span>
        </div>
        {slices.length > 1 && (
          <div className="absolute bottom-1 right-1">
            <select
              value={selectedSliceIndex}
              onChange={(e) => setSelectedSliceIndex(Number(e.target.value))}
              className={selectClassTiny}
              title="Select time slice"
            >
              {slices.map((s, i) => (
                <option key={s.id} value={i}>
                  {s.name || `Slice ${i + 1}`}{i === win.collection.coverSliceIndex ? ' (cover)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

export const CanvasPreview = ({
  sources,
  views,
  basemaps,
  activeViewId,
  draggingSourceId,
  onActiveViewChange,
  onAddView,
  onUpdateView,
  onRemoveView,
  onToggleSourceInView,
  onAddSource,
  className = '',
}: CanvasPreviewProps) => {
  const activeView = views.find((v) => v.id === activeViewId) ?? views[0] ?? null;
  const [editingViewName, setEditingViewName] = useState<string | null>(null);
  const [dragOverSources, setDragOverSources] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedCollectionIndex, setSelectedCollectionIndex] = useState(0);
  const [selectedSliceIndex, setSelectedSliceIndex] = useState(0);
  const [selectedVizIndex, setSelectedVizIndex] = useState(0);
  const dragCounter = useRef(0);
  const sourcesBoxRef = useRef<HTMLDivElement>(null);

  /* Close source picker when clicking outside the sources box */
  useEffect(() => {
    if (!showSourcePicker) return;
    const handler = (e: MouseEvent) => {
      if (sourcesBoxRef.current && !sourcesBoxRef.current.contains(e.target as Node)) {
        setShowSourcePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSourcePicker]);

  /* Determine if the source being dragged can be dropped (has collections) */
  const dragSource = draggingSourceId ? sources.find((s) => s.id === draggingSourceId) ?? null : null;
  const dragPermitted = dragSource ? dragSource.collections.length > 0 : true;

  /* Resolve all collections for the active view -preserving original order */
  const allRefs = activeView?.collectionRefs ?? [];

  const allResolved = allRefs
    .map((ref) => {
      const resolved = resolveCollection(sources, ref);
      if (!resolved) return null;
      return { ref, ...resolved } as ResolvedWindow;
    })
    .filter(Boolean) as ResolvedWindow[];

  const resolvedWindows = allResolved.filter((rw) => rw.ref.showAsWindow);
  const hiddenWindows = allResolved.filter((rw) => !rw.ref.showAsWindow);

  /* Which sources are assigned to this view */
  const assignedSourceIds = new Set(allRefs.map((r) => r.sourceId));
  const assignedSources = sources.filter((s) => assignedSourceIds.has(s.id));
  const unassignedSources = sources.filter((s) => !assignedSourceIds.has(s.id));
  const dragAlreadyAssigned = dragSource ? assignedSourceIds.has(dragSource.id) : false;

  /* Selected source and its collections in this view */
  const effectiveSelectedSourceId = selectedSourceId && assignedSourceIds.has(selectedSourceId)
    ? selectedSourceId
    : assignedSources[0]?.id ?? null;

  const selectedSource = effectiveSelectedSourceId
    ? sources.find((s) => s.id === effectiveSelectedSourceId) ?? null
    : null;

  /* Collections for the selected source that are assigned to this view */
  const collectionsForSelectedSource = allResolved.filter(
    (rw) => rw.source.id === effectiveSelectedSourceId,
  );

  /* Currently selected collection in the timeline (all collections for selected source) */
  const safeCollectionIndex = Math.min(selectedCollectionIndex, Math.max(0, collectionsForSelectedSource.length - 1));
  const activeCollection = collectionsForSelectedSource[safeCollectionIndex] ?? null;

  /* Viz options for selected source */
  const vizOptions = selectedSource?.visualizations ?? [];

  /* Crosshair and label for main map */
  const crosshair = activeCollection?.source.crosshairHex6 ?? 'ff0000';
  const collectionLabel = activeCollection
    ? (activeCollection.collection.name || sliceDateRange(activeCollection.collection.slices) || 'Main Window')
    : '';
  const slices = activeCollection?.collection.slices ?? [];

  const toggleCollectionVisibility = (collectionId: string, sourceId: string) => {
    if (!activeView) return;
    onUpdateView(activeView.id, {
      collectionRefs: activeView.collectionRefs.map((r) =>
        r.collectionId === collectionId && r.sourceId === sourceId
          ? { ...r, showAsWindow: !r.showAsWindow }
          : r,
      ),
    });
  };

  /* Drag-and-drop handlers -use counter to handle nested element enter/leave */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-source-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-source-id')) {
      e.preventDefault();
      dragCounter.current += 1;
      if (dragCounter.current === 1) {
        setDragOverSources(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOverSources(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverSources(false);
    const sourceId = e.dataTransfer.getData('application/x-source-id');
    if (sourceId) {
      const source = sources.find((s) => s.id === sourceId);
      if (source && source.collections.length > 0) {
        onToggleSourceInView(sourceId);
        setSelectedSourceId(sourceId);
      }
    }
  }, [onToggleSourceInView, sources]);

  return (
    <div className={`rounded-lg bg-neutral-100 border border-neutral-200 overflow-hidden ${className}`}>
      {/* View tabs header */}
      <div className="bg-neutral-700 px-3 py-1.5 flex items-center gap-1.5">
        {views.map((v) => {
          const isActive = activeView?.id === v.id;
          const isEditingName = editingViewName === v.id;
          return (
            <div
              key={v.id}
              className={`group flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-brand-500 text-white'
                  : 'text-neutral-300 border border-neutral-500 hover:bg-neutral-600'
              }`}
              onClick={() => onActiveViewChange(v.id)}
            >
              {isEditingName ? (
                <input
                  type="text"
                  value={v.name}
                  onChange={(e) => onUpdateView(v.id, { name: e.target.value })}
                  onBlur={() => setEditingViewName(null)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setEditingViewName(null); }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="bg-transparent border-0 border-b border-white/40 text-xs text-white outline-none w-20 py-0 px-0"
                />
              ) : (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingViewName(v.id); }}
                  title="Double-click to rename"
                >
                  {v.name || 'Untitled View'}
                </span>
              )}
              {isActive && views.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemoveView(v.id); }}
                  className="ml-1 text-white/50 hover:text-white transition-colors"
                  title="Remove view"
                >
                  <IconTrash className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAddView}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-dashed border-neutral-500 text-neutral-400 hover:text-neutral-200 hover:border-neutral-400 transition-colors cursor-pointer text-xs"
          title="Add a new view"
        >
          <IconPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Canvas body */}
      <div className="p-3">
        <div className="flex gap-1.5" style={{ minHeight: 280 }}>

          {/* Sources box (droppable) */}
          <div
            ref={sourcesBoxRef}
            className={`w-[110px] shrink-0 bg-white rounded border overflow-hidden flex flex-col transition-colors ${
              dragOverSources
                ? (dragPermitted && !dragAlreadyAssigned
                    ? 'border-brand-500 bg-brand-50/30 ring-2 ring-brand-300/40'
                    : 'border-orange-400 bg-orange-50/30 ring-2 ring-orange-200/40')
                : 'border-neutral-200'
            }`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Sources section */}
            <div className="px-2 py-1 border-b border-neutral-100">
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Sources</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
              {/* Drag feedback overlay -not permitted / already assigned */}
              {dragOverSources && (!dragPermitted || dragAlreadyAssigned) && (
                <div className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-md border border-dashed border-orange-300 bg-orange-50/60 mb-1">
                  <svg className="w-4 h-4 text-orange-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="10" cy="10" r="8" />
                    <line x1="10" y1="6" x2="10" y2="10" />
                    <circle cx="10" cy="13.5" r="0.5" fill="currentColor" stroke="none" />
                  </svg>
                  <span className="text-[10px] text-orange-700 text-center leading-tight px-1 font-medium">
                    {dragAlreadyAssigned ? 'Already added' : 'Add collections to this source first'}
                  </span>
                </div>
              )}

              {/* Drag feedback -permitted */}
              {dragOverSources && dragPermitted && !dragAlreadyAssigned && (
                <div className="flex flex-col items-center justify-center gap-1 py-3 rounded-md border-2 border-dashed border-brand-400 bg-brand-50/50 mb-1">
                  <IconPlus className="w-4 h-4 text-brand-500" />
                  <span className="text-[10px] text-brand-600 text-center leading-tight px-1 font-medium">
                    Drop to add
                  </span>
                </div>
              )}

              {!dragOverSources && assignedSources.length === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (sources.length === 0) {
                      // No sources exist -create a new one
                      onAddSource?.();
                    } else if (unassignedSources.length > 0) {
                      // Sources exist but none assigned -show picker
                      setShowSourcePicker(!showSourcePicker);
                    }
                  }}
                  className="w-full flex flex-col items-center justify-center gap-1 py-4 rounded-md border border-dashed border-neutral-200 hover:border-brand-300 hover:bg-brand-50/30 transition-colors cursor-pointer"
                >
                  <IconPlus className="w-3.5 h-3.5 text-neutral-300" />
                  <span className="text-[10px] text-center leading-tight px-1 text-neutral-400">
                    {sources.length === 0
                      ? 'Create an imagery source first'
                      : 'Drag or add sources'}
                  </span>
                </button>
              )}

              {assignedSources.map((source) => {
                const isSelected = source.id === effectiveSelectedSourceId;
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => { setSelectedSourceId(source.id); setSelectedCollectionIndex(0); setSelectedSliceIndex(0); }}
                    className={`group w-full text-left px-1.5 py-1 rounded text-[11px] leading-tight cursor-pointer transition-colors truncate flex items-center gap-1 ${
                      isSelected
                        ? 'bg-brand-500 text-white font-medium'
                        : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                    title={source.name || 'Untitled'}
                  >
                    <IconLayers className={`w-3 h-3 shrink-0 ${isSelected ? 'text-white/70' : 'text-neutral-400'}`} />
                    <span className="truncate">{source.name || 'Untitled'}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onToggleSourceInView(source.id); }}
                      className={`ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${
                        isSelected ? 'text-white/50 hover:text-white' : 'text-neutral-300 hover:text-red-500'
                      }`}
                      title="Remove from view"
                    >
                      <IconTrash className="w-2.5 h-2.5" />
                    </button>
                  </button>
                );
              })}

              {/* Add source picker -allows selecting from unassigned sources */}
              {!dragOverSources && (
                <div className="relative mt-0.5">
                  {showSourcePicker && (
                    <div
                      className="absolute left-0 right-0 bottom-full mb-1 bg-white border border-neutral-200 rounded-md shadow-lg z-30 overflow-hidden"
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {unassignedSources.length === 0 ? (
                        <div className="px-2 py-2 text-[10px] text-neutral-500 text-center">
                          All sources already added
                        </div>
                      ) : (
                        unassignedSources.map((src) => {
                          const hasCollections = src.collections.length > 0;
                          return (
                            <button
                              key={src.id}
                              type="button"
                              disabled={!hasCollections}
                              onClick={() => {
                                onToggleSourceInView(src.id);
                                setSelectedSourceId(src.id);
                                setShowSourcePicker(false);
                              }}
                              className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-brand-50 cursor-pointer transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
                              title={hasCollections ? `Add "${src.name || 'Untitled'}" to view` : 'No collections -configure source first'}
                            >
                              <IconLayers className="w-3 h-3 text-neutral-400 shrink-0" />
                              <span className="truncate font-medium text-neutral-700">{src.name || 'Untitled'}</span>
                              {!hasCollections && (
                                <span className="text-[9px] text-orange-500 shrink-0 ml-auto">No collections</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Basemaps section (bottom of sources box) */}
            <div className="border-t border-neutral-100">
              <div className="px-2 py-1 border-b border-neutral-50">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Basemaps</span>
              </div>
              <div className="p-1 space-y-0.5" style={{ maxHeight: 80 }}>
                {basemaps.length === 0 ? (
                  <span className="text-[10px] text-neutral-400 px-1">None</span>
                ) : (
                  basemaps.map((bm) => (
                    <div
                      key={bm.id}
                      className="px-1.5 py-0.5 rounded text-[10px] text-neutral-500 truncate"
                      title={bm.name || 'Basemap'}
                    >
                      {bm.name || 'Basemap'}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Timeline box */}
          <div className="w-[110px] shrink-0 bg-white rounded border border-neutral-200 overflow-hidden flex flex-col">
            <div className="px-2 py-1 border-b border-neutral-100">
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Timeline</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
              {collectionsForSelectedSource.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1 py-4 text-neutral-400">
                  <span className="text-[10px] text-center leading-tight px-1">
                    {effectiveSelectedSourceId ? 'No collections' : 'Select a source'}
                  </span>
                </div>
              ) : (
                collectionsForSelectedSource.map((rw, i) => {
                  const label = rw.collection.name || sliceDateRange(rw.collection.slices) || `Collection ${i + 1}`;
                  const isSelected = i === safeCollectionIndex;
                  return (
                    <button
                      key={rw.collection.id}
                      type="button"
                      onClick={() => { setSelectedCollectionIndex(i); setSelectedSliceIndex(0); }}
                      className={`w-full text-left px-1.5 py-1 rounded text-[11px] leading-tight cursor-pointer transition-colors truncate flex items-center gap-1 ${
                        isSelected
                          ? 'bg-brand-500 text-white font-medium'
                          : 'text-neutral-600 hover:bg-neutral-100'
                      }`}
                      title={label}
                    >
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Main content area */}
          <div className="flex-1 flex flex-col gap-1.5 min-w-0">
            {/* Main map window */}
            <div className="flex-1 relative rounded border border-neutral-300 bg-neutral-50 overflow-hidden" style={{ minHeight: 160 }}>
              {/* Grid pattern */}
              <div className="absolute inset-0 opacity-[0.04]" style={{
                backgroundImage: 'linear-gradient(to right, #666 1px, transparent 1px), linear-gradient(to bottom, #666 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }} />

              {activeCollection ? (
                <>
                  {/* Collection name (top-left) */}
                  <div className="absolute top-2 left-2 bg-white/95 rounded px-2 py-1 shadow-sm">
                    <span className="text-xs font-semibold text-neutral-700 leading-none">{collectionLabel}</span>
                  </div>

                  {/* Viz + slice selectors (top-right) */}
                  <div className="absolute top-2 right-2 flex items-center gap-1.5">
                    {slices.length > 1 && (
                      <select
                        value={selectedSliceIndex}
                        onChange={(e) => setSelectedSliceIndex(Number(e.target.value))}
                        className={selectClass}
                        title="Select time slice"
                      >
                        {slices.map((s, i) => (
                          <option key={s.id} value={i}>
                            {s.name || `Slice ${i + 1}`}{i === activeCollection.collection.coverSliceIndex ? ' (cover)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {(vizOptions.length > 0 || basemaps.length > 0) && (
                      <select
                        value={selectedVizIndex}
                        onChange={(e) => setSelectedVizIndex(Number(e.target.value))}
                        className={selectClass}
                        title="Select visualization"
                      >
                        {vizOptions.length > 0 && (
                          <optgroup label="Visualizations">
                            {vizOptions.map((v, i) => (
                              <option key={`viz-${i}`} value={i}>{v.name || `Viz ${i + 1}`}</option>
                            ))}
                          </optgroup>
                        )}
                        {basemaps.length > 0 && (
                          <optgroup label="Basemaps">
                            {basemaps.map((b, i) => (
                              <option key={`bm-${i}`} value={vizOptions.length + i}>{b.name || `Basemap ${i + 1}`}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                  </div>

                  {/* Crosshair */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <line x1="0" y1="14" x2="11" y2="14" stroke={`#${crosshair}`} strokeWidth="1.2" opacity="0.5" />
                      <line x1="17" y1="14" x2="28" y2="14" stroke={`#${crosshair}`} strokeWidth="1.2" opacity="0.5" />
                      <line x1="14" y1="0" x2="14" y2="11" stroke={`#${crosshair}`} strokeWidth="1.2" opacity="0.5" />
                      <line x1="14" y1="17" x2="14" y2="28" stroke={`#${crosshair}`} strokeWidth="1.2" opacity="0.5" />
                    </svg>
                  </div>

                  {/* Scale bar */}
                  <div className="absolute bottom-2 left-2 bg-white/90 rounded px-1.5 py-0.5 flex items-center gap-1">
                    <div className="w-8 h-px bg-neutral-600" />
                    <span className="text-[10px] text-neutral-600 leading-none">100 m</span>
                  </div>
                </>
              ) : (
                /* Empty map placeholder */
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-1.5 text-neutral-400">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8" />
                      <path d="M12 17v4" />
                    </svg>
                    <span className="text-[11px]">Select a source &amp; collection</span>
                  </div>
                </div>
              )}
            </div>

            {/* Small windows grid -always shows all visible windows regardless of selected source */}
            {resolvedWindows.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {resolvedWindows.map((win, i) => (
                  <SmallWindow
                    key={win.collection.id + '-' + i}
                    win={win}
                    index={i}
                    onHide={() => toggleCollectionVisibility(win.collection.id, win.source.id)}
                  />
                ))}
              </div>
            )}

            {/* Hidden windows -compact row to re-show */}
            {hiddenWindows.length > 0 && (
              <div className="rounded border border-dashed border-neutral-200 bg-neutral-50/50 px-2 py-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-neutral-400 font-medium uppercase tracking-wider shrink-0">
                    <IconEyeSlash className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                    Hidden
                  </span>
                  {hiddenWindows.map((hw) => {
                    const label = hw.collection.name || sliceDateRange(hw.collection.slices) || 'Untitled';
                    return (
                      <button
                        key={hw.collection.id}
                        type="button"
                        onClick={() => toggleCollectionVisibility(hw.collection.id, hw.source.id)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-neutral-500 bg-white border border-neutral-200 hover:border-brand-400 hover:text-brand-700 hover:bg-brand-50/30 transition-colors cursor-pointer"
                        title={`Show "${label}" as a window`}
                      >
                        <IconEye className="w-2.5 h-2.5" />
                        <span className="truncate max-w-[100px]">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export { CanvasPreview as EmptyCanvasHint };
