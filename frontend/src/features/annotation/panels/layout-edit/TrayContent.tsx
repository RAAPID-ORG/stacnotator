import type { ImageryViewOut } from '~/api/client';
import type { Catalog } from '~/features/annotation/core/catalog';
import { collectionsInView } from '~/features/annotation/core/catalog';
import { useWorkspaceStore } from '~/features/annotation/stores';
import {
  defaultWindowItem,
  fromGridLayout,
  toGridLayout,
  type LayoutItem,
} from '~/features/annotation/core/workspace';
import { HiddenTray, type HiddenTrayItem } from '~/features/annotation/engine/canvas';

export interface TrayContentProps {
  catalog: Catalog;
  view: ImageryViewOut | null;
  canvasRef: React.RefObject<HTMLElement | null>;
}

export function TrayContent({ catalog, view, canvasRef }: TrayContentProps) {
  const currentLayout = useWorkspaceStore((s) => s.currentLayout);
  const setLayout = useWorkspaceStore((s) => s.setLayout);
  const newWindowSize = useWorkspaceStore((s) => s.newWindowSize);

  const layout = toGridLayout(currentLayout);
  const layoutKeys = new Set(layout.map((it) => it.i));
  const size = defaultWindowItem(newWindowSize.perRow, newWindowSize.rows);

  const hiddenCollections = view
    ? collectionsInView(catalog, view).filter((c) => !layoutKeys.has(String(c.id)))
    : [];

  const items: HiddenTrayItem[] = hiddenCollections.map((collection) => {
    const sourceId = catalog.sourceIdByCollectionId.get(collection.id);
    const source = sourceId != null ? catalog.sources.get(sourceId) : undefined;
    return {
      id: String(collection.id),
      size,
      content: (
        <div className="flex min-w-0 flex-col" data-testid={`hidden-window-${collection.id}`}>
          <span className="truncate text-xs font-medium text-neutral-700">{collection.name}</span>
          {source && <span className="truncate text-[10px] text-neutral-400">{source.name}</span>}
        </div>
      ),
    };
  });

  const onDrop = (id: string, cell: { x: number; y: number }) => {
    const placed: LayoutItem = { i: id, x: cell.x, y: cell.y, ...size };
    const next = [...layout.filter((it) => it.i !== id), placed];
    setLayout(fromGridLayout(next, currentLayout));
  };

  return (
    <HiddenTray
      items={items}
      title="Hidden windows"
      storageKey="annotation:hiddenTray"
      canvasRef={canvasRef}
      layout={layout}
      onDrop={onDrop}
    />
  );
}
