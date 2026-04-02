import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ImagerySource, ImageryView, Basemap, ImagerySlice } from './types';
import { resolveCollection, sliceDateRange } from './types';
import {
  IconPlus,
  IconEyeSlash,
  IconEye,
  IconTrash,
  IconLayers,
  IconDragHandle,
} from '~/shared/ui/Icons';

interface CanvasPreviewProps {
  sources: ImagerySource[];
  views: ImageryView[];
  basemaps: Basemap[];
  activeViewId: string | null;
  onActiveViewChange: (id: string) => void;
  onAddView: () => void;
  onUpdateView: (id: string, updates: Partial<ImageryView>) => void;
  onRemoveView: (id: string) => void;
  onToggleSourceInView: (sourceId: string) => void;
  onAddSource?: () => void;
  /** Sources that are not assigned to ANY view (across all views) */
  sourcesNotInAnyView?: Set<string>;
  className?: string;
}

type ResolvedWindow = {
  ref: { collectionId: string; sourceId: string; showAsWindow: boolean };
  collection: { id: string; name: string; slices: ImagerySlice[]; coverSliceIndex: number };
  source: ImagerySource;
};

// Native select styling
const selectClass =
  "px-2 py-1 bg-white/95 text-neutral-900 text-xs font-medium rounded shadow-sm border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-6 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.35rem_center]";

const _selectClassCompact =
  "px-1.5 py-0.5 bg-white/95 text-neutral-900 text-[11px] font-medium rounded shadow-sm border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-5 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%228%22%20height%3D%228%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.25rem_center]";

const selectClassTiny =
  "px-1 py-0.5 bg-white/95 text-neutral-900 text-[9px] font-medium rounded shadow-sm border border-neutral-300 focus:outline-none cursor-pointer appearance-none pr-4 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%226%22%20height%3D%226%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23374151%22%20d%3D%22M2%204l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.2rem_center]";

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

  const collectionLabel =
    win.collection.name || sliceDateRange(win.collection.slices) || `Window ${index + 1}`;
  const sourceLabel = win.source.name || 'Untitled';
  const crosshair = win.source.crosshairHex6;
  const slices = win.collection.slices;

  return (
    <div className="rounded border border-neutral-200 bg-white overflow-hidden flex flex-col">
      <div className="bg-neutral-50 px-2 py-1 border-b border-neutral-100 flex items-center justify-between gap-1 min-h-[22px]">
        <span
          className="text-[11px] font-semibold text-neutral-700 truncate leading-none"
          title={`${collectionLabel} (${sourceLabel})`}
        >
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
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #666 1px, transparent 1px), linear-gradient(to bottom, #666 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <line
              x1="0"
              y1="8"
              x2="6"
              y2="8"
              stroke={`#${crosshair}`}
              strokeWidth="0.8"
              opacity="0.5"
            />
            <line
              x1="10"
              y1="8"
              x2="16"
              y2="8"
              stroke={`#${crosshair}`}
              strokeWidth="0.8"
              opacity="0.5"
            />
            <line
              x1="8"
              y1="0"
              x2="8"
              y2="6"
              stroke={`#${crosshair}`}
              strokeWidth="0.8"
              opacity="0.5"
            />
            <line
              x1="8"
              y1="10"
              x2="8"
              y2="16"
              stroke={`#${crosshair}`}
              strokeWidth="0.8"
              opacity="0.5"
            />
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
                  {s.name || `Slice ${i + 1}`}
                  {i === win.collection.coverSliceIndex ? ' (cover)' : ''}
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
  onActiveViewChange,
  onAddView,
  onUpdateView,
  onRemoveView,
  onToggleSourceInView,
  onAddSource,
  sourcesNotInAnyView,
  className = '',
}: CanvasPreviewProps) => {
  const activeView = views.find((v) => v.id === activeViewId) ?? views[0] ?? null;
  const [editingViewName, setEditingViewName] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedCollectionIndex, setSelectedCollectionIndex] = useState(0);
  const [selectedSliceIndex, setSelectedSliceIndex] = useState(0);
  const [selectedVizIndex, setSelectedVizIndex] = useState(0);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const addSourceBtnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Compute dropdown position when opened
  useEffect(() => {
    if (addSourceOpen && addSourceBtnRef.current) {
      const rect = addSourceBtnRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 160) });
    }
  }, [addSourceOpen]);

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

  /* Which sources are assigned to this view - ordered by first appearance in collectionRefs */
  const assignedSourceIds = new Set(allRefs.map((r) => r.sourceId));
  const orderedAssignedSourceIds: string[] = [];
  for (const ref of allRefs) {
    if (!orderedAssignedSourceIds.includes(ref.sourceId))
      orderedAssignedSourceIds.push(ref.sourceId);
  }
  const assignedSources = orderedAssignedSourceIds
    .map((id) => sources.find((s) => s.id === id))
    .filter(Boolean) as ImagerySource[];
  const unassignedSources = sources.filter((s) => !assignedSourceIds.has(s.id));

  /* Selected source and its collections in this view */
  const effectiveSelectedSourceId =
    selectedSourceId && assignedSourceIds.has(selectedSourceId)
      ? selectedSourceId
      : (assignedSources[0]?.id ?? null);

  const selectedSource = effectiveSelectedSourceId
    ? (sources.find((s) => s.id === effectiveSelectedSourceId) ?? null)
    : null;

  /* Collections for the selected source that are assigned to this view */
  const collectionsForSelectedSource = allResolved.filter(
    (rw) => rw.source.id === effectiveSelectedSourceId
  );

  /* Currently selected collection in the timeline (all collections for selected source) */
  const safeCollectionIndex = Math.min(
    selectedCollectionIndex,
    Math.max(0, collectionsForSelectedSource.length - 1)
  );
  const activeCollection = collectionsForSelectedSource[safeCollectionIndex] ?? null;

  /* Viz options for selected source */
  const vizOptions = selectedSource?.visualizations ?? [];

  /* Crosshair and label for main map */
  const crosshair = activeCollection?.source.crosshairHex6 ?? 'ff0000';
  const collectionLabel = activeCollection
    ? activeCollection.collection.name ||
      sliceDateRange(activeCollection.collection.slices) ||
      'Main Window'
    : '';
  const slices = activeCollection?.collection.slices ?? [];

  const toggleCollectionVisibility = (collectionId: string, sourceId: string) => {
    if (!activeView) return;
    onUpdateView(activeView.id, {
      collectionRefs: activeView.collectionRefs.map((r) =>
        r.collectionId === collectionId && r.sourceId === sourceId
          ? { ...r, showAsWindow: !r.showAsWindow }
          : r
      ),
    });
  };

  /** Reorder sources within this view via drag-and-drop */
  const dragSourceIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const reorderSourceInView = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (!activeView || fromIdx === toIdx) return;
      // Get unique source IDs in the order they first appear in collectionRefs
      const ordered: string[] = [];
      for (const ref of activeView.collectionRefs) {
        if (!ordered.includes(ref.sourceId)) ordered.push(ref.sourceId);
      }
      if (fromIdx < 0 || toIdx < 0 || fromIdx >= ordered.length || toIdx >= ordered.length) return;
      // Move element
      const [moved] = ordered.splice(fromIdx, 1);
      ordered.splice(toIdx, 0, moved);
      // Rebuild collectionRefs in new source order
      const reordered = ordered.flatMap((sid) =>
        activeView.collectionRefs.filter((r) => r.sourceId === sid)
      );
      onUpdateView(activeView.id, { collectionRefs: reordered });
    },
    [activeView, onUpdateView]
  );

  return (
    <div
      className={`rounded-lg bg-neutral-100 border border-neutral-200 overflow-hidden ${className}`}
    >
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
              onClick={() => {
                if (isActive && !isEditingName) {
                  setEditingViewName(v.id);
                } else {
                  onActiveViewChange(v.id);
                }
              }}
            >
              {isEditingName ? (
                <input
                  type="text"
                  value={v.name}
                  onChange={(e) => onUpdateView(v.id, { name: e.target.value })}
                  onBlur={() => setEditingViewName(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setEditingViewName(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="bg-transparent border-0 border-b border-white/40 text-xs text-white outline-none w-20 py-0 px-0"
                />
              ) : (
                <span
                  className="flex items-center gap-1"
                  title={isActive ? 'Click to rename' : 'Click to switch view'}
                >
                  {v.name || 'Untitled View'}
                  {isActive && (
                    <svg
                      className="w-2.5 h-2.5 text-white/50"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
                    </svg>
                  )}
                </span>
              )}
              {isActive && views.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveView(v.id);
                  }}
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
          {/* Sources box */}
          <div
            className={`w-[140px] shrink-0 bg-white rounded border overflow-hidden flex flex-col ${
              assignedSources.length === 0 && sources.length > 0
                ? 'border-amber-300 bg-amber-50/30'
                : 'border-neutral-200'
            }`}
          >
            {/* Sources section header */}
            <div className="px-2 py-1 border-b border-neutral-100">
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                Sources
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
              {assignedSources.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-1.5 py-4 px-2">
                  <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
                    <IconPlus className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                  <span className="text-[10px] text-amber-600 text-center leading-tight font-medium">
                    Add sources to this view
                  </span>
                  <span className="text-[9px] text-neutral-400 text-center leading-tight">
                    Sources must be assigned to a view to appear in the annotation canvas
                  </span>
                </div>
              )}

              {assignedSources.map((source, idx) => {
                const isSelected = source.id === effectiveSelectedSourceId;
                return (
                  <div
                    key={source.id}
                    draggable
                    onDragStart={() => {
                      dragSourceIdx.current = idx;
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIdx(idx);
                    }}
                    onDrop={() => {
                      if (dragSourceIdx.current !== null)
                        reorderSourceInView(dragSourceIdx.current, idx);
                      dragSourceIdx.current = null;
                      setDragOverIdx(null);
                    }}
                    onDragEnd={() => {
                      dragSourceIdx.current = null;
                      setDragOverIdx(null);
                    }}
                    className={`group flex items-center gap-0.5 rounded transition-colors cursor-grab active:cursor-grabbing ${
                      isSelected
                        ? 'bg-brand-500 text-white'
                        : 'text-neutral-600 hover:bg-neutral-100'
                    } ${dragOverIdx === idx ? 'ring-1 ring-brand-400 ring-offset-1' : ''}`}
                  >
                    {/* Drag grip */}
                    <span
                      className={`shrink-0 px-0.5 ${isSelected ? 'text-white/40' : 'text-neutral-300'}`}
                    >
                      <IconDragHandle className="w-2.5 h-2.5" />
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSourceId(source.id);
                        setSelectedCollectionIndex(0);
                        setSelectedSliceIndex(0);
                      }}
                      className={`flex-1 min-w-0 text-left px-1 py-1 text-[11px] leading-tight cursor-pointer flex items-center gap-1 ${
                        isSelected ? 'font-medium' : ''
                      }`}
                      title={source.name || 'Untitled'}
                    >
                      <IconLayers
                        className={`w-3 h-3 shrink-0 ${isSelected ? 'text-white/70' : 'text-neutral-400'}`}
                      />
                      <span className="break-words whitespace-normal leading-snug">
                        {source.name || 'Untitled'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSourceInView(source.id);
                      }}
                      className={`shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 ${
                        isSelected
                          ? 'text-white/50 hover:text-white'
                          : 'text-neutral-300 hover:text-red-500'
                      }`}
                      title="Remove from view"
                    >
                      <IconTrash className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}

              {/* Add source button + portal dropdown */}
              <div className="mt-0.5">
                <button
                  ref={addSourceBtnRef}
                  type="button"
                  onClick={() => setAddSourceOpen((v) => !v)}
                  className="w-full flex items-center justify-center gap-1 px-1.5 py-1.5 text-[11px] text-neutral-500 rounded border border-dashed border-neutral-200 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50/40 transition-colors cursor-pointer"
                >
                  <IconPlus className="w-3 h-3" />
                  <span>Add source</span>
                </button>
                {addSourceOpen &&
                  dropdownPos &&
                  createPortal(
                    <>
                      {/* Backdrop to close */}
                      <div
                        className="fixed inset-0 z-[9998]"
                        onClick={() => setAddSourceOpen(false)}
                      />
                      <div
                        className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-neutral-200 overflow-hidden"
                        style={{
                          top: dropdownPos.top,
                          left: dropdownPos.left,
                          width: dropdownPos.width,
                        }}
                      >
                        {unassignedSources.length > 0 && (
                          <div className="py-1">
                            <div className="px-2.5 py-1 text-[9px] font-semibold text-neutral-400 uppercase tracking-wider">
                              Available
                            </div>
                            {unassignedSources.map((src) => {
                              const hasCollections = src.collections.length > 0;
                              return (
                                <button
                                  key={src.id}
                                  type="button"
                                  disabled={!hasCollections}
                                  onClick={() => {
                                    onToggleSourceInView(src.id);
                                    setSelectedSourceId(src.id);
                                    setAddSourceOpen(false);
                                  }}
                                  className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors ${
                                    hasCollections
                                      ? 'text-neutral-700 hover:bg-brand-50 hover:text-brand-700 cursor-pointer'
                                      : 'text-neutral-300 cursor-not-allowed'
                                  }`}
                                >
                                  <IconLayers
                                    className={`w-3 h-3 shrink-0 ${hasCollections ? 'text-neutral-400' : 'text-neutral-200'}`}
                                  />
                                  <span className="truncate">{src.name || 'Untitled'}</span>
                                  {!hasCollections && (
                                    <span className="text-[9px] text-neutral-300 ml-auto shrink-0">
                                      no collections
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {unassignedSources.length === 0 && sources.length > 0 && (
                          <div className="px-2.5 py-2.5 text-[11px] text-neutral-400 text-center">
                            All sources already added
                          </div>
                        )}
                        <div className="border-t border-neutral-100">
                          <button
                            type="button"
                            onClick={() => {
                              onAddSource?.();
                              setAddSourceOpen(false);
                            }}
                            className="w-full text-left px-2.5 py-2 text-[11px] text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer flex items-center gap-1.5 font-medium"
                          >
                            <IconPlus className="w-3 h-3" />
                            <span>Create new source…</span>
                          </button>
                        </div>
                      </div>
                    </>,
                    document.body
                  )}
              </div>
            </div>

            {/* Basemaps section (bottom of sources box) */}
            <div className="border-t border-neutral-100">
              <div className="px-2 py-1 border-b border-neutral-50">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Basemaps
                </span>
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
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                Timeline
              </span>
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
                  const label =
                    rw.collection.name ||
                    sliceDateRange(rw.collection.slices) ||
                    `Collection ${i + 1}`;
                  const isSelected = i === safeCollectionIndex;
                  return (
                    <button
                      key={rw.collection.id}
                      type="button"
                      onClick={() => {
                        setSelectedCollectionIndex(i);
                        setSelectedSliceIndex(0);
                      }}
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
            <div
              className="flex-1 relative rounded border border-neutral-300 bg-neutral-50 overflow-hidden"
              style={{ minHeight: 160 }}
            >
              {/* Grid pattern */}
              <div
                className="absolute inset-0 opacity-[0.04]"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, #666 1px, transparent 1px), linear-gradient(to bottom, #666 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              />

              {activeCollection ? (
                <>
                  {/* Collection name (top-left) */}
                  <div className="absolute top-2 left-2 bg-white/95 rounded px-2 py-1 shadow-sm">
                    <span className="text-xs font-semibold text-neutral-700 leading-none">
                      {collectionLabel}
                    </span>
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
                            {s.name || `Slice ${i + 1}`}
                            {i === activeCollection.collection.coverSliceIndex ? ' (cover)' : ''}
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
                              <option key={`viz-${i}`} value={i}>
                                {v.name || `Viz ${i + 1}`}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {basemaps.length > 0 && (
                          <optgroup label="Basemaps">
                            {basemaps.map((b, i) => (
                              <option key={`bm-${i}`} value={vizOptions.length + i}>
                                {b.name || `Basemap ${i + 1}`}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                  </div>

                  {/* Crosshair */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <line
                        x1="0"
                        y1="14"
                        x2="11"
                        y2="14"
                        stroke={`#${crosshair}`}
                        strokeWidth="1.2"
                        opacity="0.5"
                      />
                      <line
                        x1="17"
                        y1="14"
                        x2="28"
                        y2="14"
                        stroke={`#${crosshair}`}
                        strokeWidth="1.2"
                        opacity="0.5"
                      />
                      <line
                        x1="14"
                        y1="0"
                        x2="14"
                        y2="11"
                        stroke={`#${crosshair}`}
                        strokeWidth="1.2"
                        opacity="0.5"
                      />
                      <line
                        x1="14"
                        y1="17"
                        x2="14"
                        y2="28"
                        stroke={`#${crosshair}`}
                        strokeWidth="1.2"
                        opacity="0.5"
                      />
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
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8" />
                      <path d="M12 17v4" />
                    </svg>
                    <span className="text-[11px]">Select a source &amp; collection</span>
                  </div>
                </div>
              )}
            </div>

            {/* Warning when too many visible windows */}
            {resolvedWindows.length > 12 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800 text-[11px]">
                <svg
                  className="w-3.5 h-3.5 shrink-0 text-amber-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>
                  <strong>{resolvedWindows.length}</strong> visible windows may slow performance.
                  Consider hiding some or splitting across views.
                </span>
              </div>
            )}

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
                    const label =
                      hw.collection.name || sliceDateRange(hw.collection.slices) || 'Untitled';
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

        {/* Warning: sources not assigned to any view */}
        {sourcesNotInAnyView && sourcesNotInAnyView.size > 0 && (
          <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded border border-red-200 bg-red-50/60">
            <svg
              className="w-3.5 h-3.5 shrink-0 text-red-400 mt-0.5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 1 0 8.94 6.94ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
            <div className="text-[11px] text-red-700 leading-relaxed">
              <span className="font-semibold">
                {sourcesNotInAnyView.size === 1
                  ? '1 source'
                  : `${sourcesNotInAnyView.size} sources`}{' '}
                not in any view:
              </span>{' '}
              {sources
                .filter((s) => sourcesNotInAnyView.has(s.id))
                .map((s) => s.name || 'Untitled')
                .join(', ')}
              <span className="text-red-500">
                {' '}
                - add {sourcesNotInAnyView.size === 1 ? 'it' : 'them'} to a view above or{' '}
                {sourcesNotInAnyView.size === 1 ? 'it' : 'they'} won't appear for annotators.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export { CanvasPreview as EmptyCanvasHint };
