import type { ImageryViewOut } from '~/api/client';
import type { ImageryCatalog } from '../../campaign/imagery';
import { collectionsInView } from '../../campaign/imagery';
import { useLayoutStore } from '../../stores/layout';
import { defaultWindowItem, fromGridLayout, toGridLayout, type LayoutItem } from '../grid';
import { HiddenTray, type HiddenTrayItem } from './HiddenTray';
import { ViewAdmin } from './ViewAdmin';

const MIN_PER_ROW = 2;
const MAX_PER_ROW = 10;
const MIN_WINDOW_H = 5;
const MAX_WINDOW_H = 20;

export interface TrayContentProps {
  catalog: ImageryCatalog;
  view: ImageryViewOut | null;
  canvasRef: React.RefObject<HTMLElement | null>;
  /** Views are a campaign-wide definition, so only an admin gets that section. */
  isCampaignAdmin: boolean;
}

const sectionHeading = 'block text-[11px] font-medium uppercase tracking-wider text-neutral-500';

function HiddenPanelsSection() {
  const newWindowSize = useLayoutStore((s) => s.newWindowSize);
  const setNewWindowSize = useLayoutStore((s) => s.setNewWindowSize);
  const hideAllWindows = useLayoutStore((s) => s.hideAllWindows);
  const hasVisibleWindows = useLayoutStore((s) => Object.keys(s.currentLayout.windows).length > 0);

  return (
    <div className="space-y-2" data-testid="new-window-size">
      <div className="flex items-center justify-between gap-2">
        <span className={sectionHeading}>Hidden panels</span>
        <button
          type="button"
          onClick={hideAllWindows}
          disabled={!hasVisibleWindows}
          className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="hide-all-windows"
        >
          Hide all
        </button>
      </div>
      <span className={sectionHeading}>New panel size</span>
      <p className="text-[11px] leading-snug text-neutral-400">
        Sets the width and height a hidden panel gets when it's added back to the canvas.
      </p>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[11px] text-neutral-500">
          <span className="w-12 shrink-0">Per row</span>
          <input
            type="range"
            min={MIN_PER_ROW}
            max={MAX_PER_ROW}
            step={1}
            value={newWindowSize.perRow}
            onChange={(e) =>
              setNewWindowSize({ perRow: Number(e.target.value), rows: newWindowSize.rows })
            }
            className="h-1.5 flex-1 cursor-pointer accent-brand-600"
            aria-label="Panels per row"
          />
          <span className="w-4 text-right font-medium tabular-nums text-neutral-700">
            {newWindowSize.perRow}
          </span>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-neutral-500">
          <span className="w-12 shrink-0">Height</span>
          <input
            type="range"
            min={MIN_WINDOW_H}
            max={MAX_WINDOW_H}
            step={1}
            value={newWindowSize.rows}
            onChange={(e) =>
              setNewWindowSize({ perRow: newWindowSize.perRow, rows: Number(e.target.value) })
            }
            className="h-1.5 flex-1 cursor-pointer accent-brand-600"
            aria-label="Panel height"
          />
          <span className="w-4 text-right font-medium tabular-nums text-neutral-700">
            {newWindowSize.rows}
          </span>
        </label>
      </div>
    </div>
  );
}

export function TrayContent({ catalog, view, canvasRef, isCampaignAdmin }: TrayContentProps) {
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const setLayout = useLayoutStore((s) => s.setLayout);
  const newWindowSize = useLayoutStore((s) => s.newWindowSize);

  const layout = toGridLayout(currentLayout);
  const layoutKeys = new Set(layout.map((it) => it.i));
  const size = defaultWindowItem(newWindowSize.perRow, newWindowSize.rows);

  const hiddenCollections = view
    ? collectionsInView(catalog, view).filter((c) => !layoutKeys.has(String(c.id)))
    : [];

  const items: HiddenTrayItem[] = hiddenCollections.map((collection) => {
    const sourceId = catalog.sourceOf.get(collection.id);
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
      title="Layout"
      sections={
        isCampaignAdmin ? (
          <div className="space-y-2">
            <span className={sectionHeading}>Views</span>
            <ViewAdmin />
          </div>
        ) : null
      }
      headerExtra={<HiddenPanelsSection />}
      storageKey="annotation:layoutPanel"
      canvasRef={canvasRef}
      layout={layout}
      onDrop={onDrop}
    />
  );
}
