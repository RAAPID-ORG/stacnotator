import { useState, type ReactNode } from 'react';
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
  settingUpFirstView?: boolean;
  footerActions: ReactNode;
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
        <p className="text-[11px] leading-snug text-neutral-500">Click a panel to restore it.</p>
      )}

      {sizeOpen && (
        <div className="space-y-2 rounded-lg bg-neutral-50 p-2" data-testid="new-window-size">
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

export function TrayContent({
  catalog,
  view,
  isCampaignAdmin,
  settingUpFirstView = false,
  footerActions,
}: TrayContentProps) {
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
        <div
          className="flex min-w-0 items-baseline gap-2"
          data-testid={`hidden-window-${collection.id}`}
        >
          <span
            className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700"
            title={collection.name}
          >
            {collection.name}
          </span>
          {source && (
            <span className="max-w-[40%] truncate text-[10px] text-neutral-400" title={source.name}>
              {source.name}
            </span>
          )}
        </div>
      ),
    };
  });

  return (
    <HiddenTray
      items={items}
      title="Edit Layout"
      footerActions={footerActions}
      sections={
        <>
          {settingUpFirstView && (
            <div
              className="mb-2 rounded-md border border-brand-200 bg-brand-50 p-2 text-xs leading-snug text-brand-900"
              data-testid="first-view-setup-guidance"
            >
              <p className="mb-1 font-medium">Setting up the workspace</p>
              <p>
                Drag and resize panels into your team's starting arrangement, then select{' '}
                <span className="font-medium">Save layout</span> at the bottom of this panel to show
                imagery. Everyone can rearrange their own copy later through Edit Layout.
              </p>
              <p className="mt-2">Drag this panel by its header to move it out of the way.</p>
            </div>
          )}
          {isCampaignAdmin && (
            <div className="mb-2 border-b border-neutral-100 pb-2">
              <ViewAdmin />
            </div>
          )}
          <NavigationPanels />
        </>
      }
      listHeader={<HiddenPanelsHeader count={items.length} />}
      storageKey="annotation:layoutPanel"
      onAdd={(id) => showWindow(Number(id))}
    />
  );
}

function NavigationPanels() {
  const main = useLayoutStore((s) => s.currentLayout.main);
  const setPanel = useLayoutStore((s) => s.setNavigationPanel);
  const setOptions = useLayoutStore((s) => s.setPanelOptions);

  return (
    <div className="space-y-1 text-xs text-neutral-600">
      <h3 className={`${sectionHeading} mb-1.5`}>Map navigation</h3>
      {(['timeline', 'imagery'] as const).map((id) => {
        const item = main[id];
        const label = id === 'timeline' ? 'Timeline' : 'Imagery controls';
        return (
          <div key={id} className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5">
            <label className="flex min-w-0 cursor-pointer items-center gap-2 text-neutral-700">
              <input
                type="checkbox"
                checked={!!item}
                aria-label={`${label} in a separate panel`}
                onChange={(e) => setPanel(id, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-600"
              />
              {id === 'timeline' ? 'Timeline panel' : 'Imagery panel'}
            </label>
            <select
              aria-label={`${label} orientation`}
              disabled={!item}
              value={item?.orientation ?? (id === 'timeline' ? 'vertical' : 'horizontal')}
              onChange={(e) =>
                setOptions(id, {
                  orientation: e.target.value === 'horizontal' ? 'horizontal' : 'vertical',
                })
              }
              className="h-6 w-24 shrink-0 rounded-md border border-neutral-200 bg-white px-1.5 text-[11px] text-neutral-600 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </div>
        );
      })}
      <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-neutral-700">
        <input
          type="checkbox"
          checked={main.main.slice_navigation ?? false}
          onChange={(e) => setOptions('main', { slice_navigation: e.target.checked })}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-600"
        />
        Desktop slice navigation
      </label>
    </div>
  );
}
