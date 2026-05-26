import { useEffect, useState } from 'react';
import type { ImageryController } from './controller';
import { CanvasPreview } from './CanvasPreview';
import type { ImageryView, ViewCollectionRef } from './types';
import { createId } from './types';

interface ViewLayoutTabProps {
  controller: ImageryController;
}

export const ViewLayoutTab = ({ controller }: ViewLayoutTabProps) => {
  const { sources, views, basemaps } = controller.state;
  const [activeViewId, setActiveViewId] = useState<string | null>(views[0]?.id ?? null);

  useEffect(() => {
    if (!views.some((v) => v.id === activeViewId)) setActiveViewId(views[0]?.id ?? null);
  }, [views, activeViewId]);

  const assignedSourceIds = new Set(views.flatMap((v) => v.collectionRefs.map((r) => r.sourceId)));
  const unassignedSources = sources.filter((s) => !assignedSourceIds.has(s.id));
  const sourcesNotInAnyView = new Set(unassignedSources.map((s) => s.id));

  const addView = () => {
    const v: ImageryView = {
      id: createId(),
      name: `View ${views.length + 1}`,
      collectionRefs: [],
    };
    void controller.addView(v);
    setActiveViewId(v.id);
  };

  const toggleSourceInView = (sourceId: string) => {
    const view = views.find((v) => v.id === activeViewId);
    const source = sources.find((s) => s.id === sourceId);
    if (!view || !source) return;
    const isAssigned = view.collectionRefs.some((r) => r.sourceId === sourceId);
    const nextRefs: ViewCollectionRef[] = isAssigned
      ? view.collectionRefs.filter((r) => r.sourceId !== sourceId)
      : [
          ...view.collectionRefs,
          ...source.collections.map((c) => ({
            collectionId: c.id,
            sourceId,
            showAsWindow: true,
          })),
        ];
    void controller.updateView(view.id, { collectionRefs: nextRefs });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Arrange sources into views (tabs that annotators switch between) and pick which collections
        are visible as map windows.
      </p>

      {sources.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold mb-2">
            Sources ({sources.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => {
              const inView = !sourcesNotInAnyView.has(s.id);
              return (
                <span
                  key={s.id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${
                    inView
                      ? 'bg-brand-50 text-brand-700 border-brand-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                  title={inView ? 'Assigned to at least one view' : 'Not in any view yet'}
                >
                  {!inView && (
                    <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="currentColor">
                      <circle cx="6" cy="6" r="5" />
                    </svg>
                  )}
                  {s.name || 'Untitled'}
                </span>
              );
            })}
          </div>
          {unassignedSources.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-2">
              {unassignedSources.length === 1
                ? 'This source is'
                : `${unassignedSources.length} sources are`}{' '}
              not in any view yet. Activate a view and toggle them in below.
            </p>
          )}
        </div>
      )}

      <CanvasPreview
        sources={sources}
        views={views}
        basemaps={basemaps}
        activeViewId={activeViewId}
        onActiveViewChange={setActiveViewId}
        onAddView={addView}
        onUpdateView={(id, patch) => void controller.updateView(id, patch)}
        onRemoveView={(id) => void controller.removeView(id)}
        onMoveView={(id, direction) => {
          const idx = views.findIndex((v) => v.id === id);
          const ni = idx + direction;
          if (idx < 0 || ni < 0 || ni >= views.length) return;
          const next = [...views];
          [next[idx], next[ni]] = [next[ni], next[idx]];
          void controller.reorderViews(next.map((v) => v.id));
        }}
        onToggleSourceInView={toggleSourceInView}
        sourcesNotInAnyView={sourcesNotInAnyView}
      />
    </div>
  );
};
