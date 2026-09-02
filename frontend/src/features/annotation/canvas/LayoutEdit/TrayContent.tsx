import { useState } from 'react';
import type { ImageryViewOut } from '~/api/client';
import type { ImageryCatalog } from '../../campaign/imagery';
import { collectionsInView } from '../../campaign/imagery';
import { IconSliders } from '~/shared/ui/Icons';
import { useLayoutStore } from '../../stores/layout';
import { toGridLayout } from '../grid';
import { HiddenTray, type HiddenTrayItem } from './HiddenTray';
import { ViewAdmin } from './ViewAdmin';

const MIN_PER_ROW = 2;
const MAX_PER_ROW = 10;
const MIN_WINDOW_H = 5;
const MAX_WINDOW_H = 20;

export interface TrayContentProps {
  catalog: ImageryCatalog;
  view: ImageryViewOut | null;
  /** Views are a campaign-wide definition, so only an admin gets that section. */
  isCampaignAdmin: boolean;
}

const sectionHeading = 'block text-[11px] font-medium uppercase tracking-wider text-neutral-500';

/** Names the list of hidden panels, says what to do with it - the rows are the
 *  only way a panel gets back onto the canvas, and nothing else says so - and
 *  hides the size the rows are added at behind a toggle, since it belongs to
 *  this list but is touched far less often than the list itself. */
function HiddenPanelsHeader({ count }: { count: number }) {
  const hideAllWindows = useLayoutStore((s) => s.hideAllWindows);
  const hasVisibleWindows = useLayoutStore((s) => Object.keys(s.currentLayout.windows).length > 0);
  const newWindowSize = useLayoutStore((s) => s.newWindowSize);
  const setNewWindowSize = useLayoutStore((s) => s.setNewWindowSize);
  const [sizeOpen, setSizeOpen] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className={sectionHeading}>Hidden panels ({count})</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSizeOpen((v) => !v)}
            aria-expanded={sizeOpen}
            title="Size new panels are added at"
            aria-label="Size new panels are added at"
            className={`grid h-5 w-5 place-items-center rounded transition-colors ${
              sizeOpen
                ? 'bg-brand-100 text-brand-700'
                : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700'
            }`}
            data-testid="toggle-new-window-size"
          >
            <IconSliders className="h-3.5 w-3.5" />
          </button>
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
      </div>

      {count > 0 && !sizeOpen && (
        <p className="text-[11px] leading-snug text-neutral-500">
          Click one to put it back on the canvas.
        </p>
      )}

      {sizeOpen && (
        <div className="space-y-2 rounded-lg bg-neutral-50 p-2" data-testid="new-window-size">
          <p className="text-[11px] leading-snug text-neutral-500">
            The size a panel is added back at.
          </p>
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
      )}
    </div>
  );
}

export function TrayContent({ catalog, view, isCampaignAdmin }: TrayContentProps) {
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const showWindow = useLayoutStore((s) => s.showWindow);

  const layoutKeys = new Set(toGridLayout(currentLayout).map((it) => it.i));

  const hiddenCollections = view
    ? collectionsInView(catalog, view).filter((c) => !layoutKeys.has(String(c.id)))
    : [];

  const items: HiddenTrayItem[] = hiddenCollections.map((collection) => {
    const sourceId = catalog.sourceOf.get(collection.id);
    const source = sourceId != null ? catalog.sources.get(sourceId) : undefined;
    return {
      id: String(collection.id),
      content: (
        <div className="flex min-w-0 flex-col" data-testid={`hidden-window-${collection.id}`}>
          <span className="truncate text-xs font-medium text-neutral-700">{collection.name}</span>
          {source && <span className="truncate text-[10px] text-neutral-400">{source.name}</span>}
        </div>
      ),
    };
  });

  return (
    <HiddenTray
      items={items}
      title="Layout"
      sections={isCampaignAdmin ? <ViewAdmin /> : null}
      listHeader={<HiddenPanelsHeader count={items.length} />}
      storageKey="annotation:layoutPanel"
      onAdd={(id) => showWindow(Number(id))}
    />
  );
}
