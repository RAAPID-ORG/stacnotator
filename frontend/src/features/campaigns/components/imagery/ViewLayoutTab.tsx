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
  const sourcesNotInAnyView = new Set(
    sources.filter((s) => !assignedSourceIds.has(s.id)).map((s) => s.id)
  );

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
