import { useState } from 'react';
import type { ImageryView, ImagerySource, ViewCollectionRef } from './types';
import { allCollectionsFlat, swap, sliceDateRange } from './types';
import {
  IconTrash,
  IconChevronDown,
  IconChevronUp,
  IconMap,
  IconEye,
  IconEyeSlash,
} from '~/shared/ui/Icons';
import { Tooltip } from './Tooltip';

interface ViewEditorProps {
  view: ImageryView;
  sources: ImagerySource[];
  onChange: (updates: Partial<ImageryView>) => void;
  onRemove: () => void;
  isFirst: boolean;
}

export const ViewEditor = ({ view, sources, onChange, onRemove, isFirst }: ViewEditorProps) => {
  const [expanded, setExpanded] = useState(true);

  const allCollections = allCollectionsFlat(sources);
  const windowCount = view.collectionRefs.filter((r) => r.showAsWindow).length;
  const timelineCount = view.collectionRefs.filter((r) => !r.showAsWindow).length;

  const isReferenced = (sourceId: string, collectionId: string) =>
    view.collectionRefs.some((r) => r.sourceId === sourceId && r.collectionId === collectionId);

  const toggleCollection = (sourceId: string, collectionId: string) => {
    if (isReferenced(sourceId, collectionId)) {
      onChange({
        collectionRefs: view.collectionRefs.filter(
          (r) => !(r.sourceId === sourceId && r.collectionId === collectionId)
        ),
      });
    } else {
      onChange({
        collectionRefs: [...view.collectionRefs, { collectionId, sourceId, showAsWindow: true }],
      });
    }
  };

  const toggleShowAsWindow = (sourceId: string, collectionId: string) => {
    onChange({
      collectionRefs: view.collectionRefs.map((r) =>
        r.sourceId === sourceId && r.collectionId === collectionId
          ? { ...r, showAsWindow: !r.showAsWindow }
          : r
      ),
    });
  };

  const addAllFromSource = (sourceId: string) => {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;
    const newRefs: ViewCollectionRef[] = source.collections
      .filter((c) => !isReferenced(sourceId, c.id))
      .map((c) => ({ collectionId: c.id, sourceId, showAsWindow: true }));
    onChange({ collectionRefs: [...view.collectionRefs, ...newRefs] });
  };

  const removeAllFromSource = (sourceId: string) => {
    onChange({
      collectionRefs: view.collectionRefs.filter((r) => r.sourceId !== sourceId),
    });
  };

  return (
    <div className="rounded-lg border border-neutral-300 bg-white overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-neutral-50 cursor-pointer hover:bg-neutral-100 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <IconMap className="w-4 h-4 text-brand-600 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-900">
                {view.name || 'Untitled View'}
              </span>
              {isFirst && (
                <span className="text-[10px] px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded">
                  Default
                </span>
              )}
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              {view.collectionRefs.length === 0
                ? 'No collections assigned'
                : `${view.collectionRefs.length} collection${view.collectionRefs.length !== 1 ? 's' : ''}`}
              {windowCount > 0 && ` · ${windowCount} window${windowCount !== 1 ? 's' : ''}`}
              {timelineCount > 0 && ` · ${timelineCount} timeline only`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="text-red-400 hover:text-red-600 transition-colors cursor-pointer p-1"
          >
            <IconTrash className="w-4 h-4" />
          </button>
          {expanded ? (
            <IconChevronUp className="w-4 h-4 text-neutral-400" />
          ) : (
            <IconChevronDown className="w-4 h-4 text-neutral-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-neutral-700 flex items-center gap-1">
              View Name
              <Tooltip text="Display name for this view. Shown as a tab in the annotation canvas." />
            </label>
            <input
              type="text"
              placeholder="e.g. Sentinel-2, Overview, Comparison"
              value={view.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="w-full border-brand-600 border-b focus:border-b-2 outline-none focus:ring-0 text-sm"
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-medium text-neutral-700 flex items-center gap-1">
              Assign Collections
              <Tooltip text="Pick which collections appear in this view and whether each gets its own map window or is timeline-only." />
            </h4>

            {allCollections.length === 0 && (
              <div className="rounded-md border border-dashed border-neutral-300 p-4 text-center">
                <p className="text-xs text-neutral-500">
                  No sources yet. Add an imagery source first, then assign its collections here.
                </p>
              </div>
            )}

            {sources
              .filter((s) => s.collections.length > 0)
              .map((source) => {
                const sourceRefs = view.collectionRefs.filter((r) => r.sourceId === source.id);
                const allSelected = source.collections.every((c) => isReferenced(source.id, c.id));
                const noneSelected = sourceRefs.length === 0;

                return (
                  <div
                    key={source.id}
                    className="rounded border border-neutral-200 overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-3 py-2 bg-neutral-50">
                      <span className="text-xs font-medium text-neutral-700">
                        {source.name || 'Untitled Source'}
                        <span className="text-neutral-400 ml-1">({source.collections.length})</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {!allSelected && (
                          <button
                            type="button"
                            onClick={() => addAllFromSource(source.id)}
                            className="text-[11px] text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
                          >
                            Add all
                          </button>
                        )}
                        {!noneSelected && (
                          <button
                            type="button"
                            onClick={() => removeAllFromSource(source.id)}
                            className="text-[11px] text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                          >
                            Remove all
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-neutral-100">
                      {source.collections.map((col) => {
                        const ref = view.collectionRefs.find(
                          (r) => r.sourceId === source.id && r.collectionId === col.id
                        );
                        const selected = !!ref;
                        return (
                          <div
                            key={col.id}
                            className={`flex items-center justify-between px-3 py-1.5 ${
                              selected ? 'bg-brand-50/40' : ''
                            }`}
                          >
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleCollection(source.id, col.id)}
                                className="accent-brand-500 cursor-pointer"
                              />
                              <span className="text-xs text-neutral-700 truncate">
                                {col.name || sliceDateRange(col.slices) || 'Untitled'}
                              </span>
                            </label>
                            {selected && (
                              <button
                                type="button"
                                onClick={() => toggleShowAsWindow(source.id, col.id)}
                                className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                                  ref.showAsWindow
                                    ? 'text-brand-700 bg-brand-100'
                                    : 'text-neutral-500 bg-neutral-100'
                                }`}
                                title={ref.showAsWindow ? 'Shown as window' : 'Timeline only'}
                              >
                                {ref.showAsWindow ? (
                                  <>
                                    <IconEye className="w-3 h-3" />
                                    Window
                                  </>
                                ) : (
                                  <>
                                    <IconEyeSlash className="w-3 h-3" />
                                    Timeline
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Collection ordering */}
          {view.collectionRefs.length > 1 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-neutral-700 flex items-center gap-1">
                Collection Order
                <Tooltip text="Drag order determines layer stacking and window arrangement. Move items up or down." />
              </h4>
              <div className="rounded border border-neutral-200 divide-y divide-neutral-100">
                {view.collectionRefs.map((ref, i) => {
                  const source = sources.find((s) => s.id === ref.sourceId);
                  const col = source?.collections.find((c) => c.id === ref.collectionId);
                  if (!source || !col) return null;
                  return (
                    <div
                      key={`${ref.sourceId}-${ref.collectionId}`}
                      className="flex items-center justify-between px-3 py-1.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-neutral-400 w-4 text-right shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-xs text-neutral-700 truncate">
                          {col.name || sliceDateRange(col.slices) || 'Untitled'}
                        </span>
                        <span className="text-[10px] text-neutral-400 shrink-0">
                          {source.name || 'Untitled'}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            onChange({ collectionRefs: swap(view.collectionRefs, i, i - 1) })
                          }
                          disabled={i === 0}
                          className="text-neutral-400 hover:text-neutral-600 disabled:text-neutral-200 transition-colors cursor-pointer disabled:cursor-default p-0.5"
                          title="Move up"
                        >
                          <IconChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onChange({ collectionRefs: swap(view.collectionRefs, i, i + 1) })
                          }
                          disabled={i === view.collectionRefs.length - 1}
                          className="text-neutral-400 hover:text-neutral-600 disabled:text-neutral-200 transition-colors cursor-pointer disabled:cursor-default p-0.5"
                          title="Move down"
                        >
                          <IconChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
