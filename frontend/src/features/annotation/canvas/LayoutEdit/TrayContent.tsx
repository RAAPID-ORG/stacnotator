import { useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { ImageryViewOut } from '~/api/client';
import type { ImageryCatalog } from '../../campaign/imagery';
import { collectionsInView, windowsShown } from '../../campaign/imagery';
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
function HiddenPanelsHeader({ count, shown }: { count: number; shown: number[] }) {
  const { t } = useTranslation('annotation');
  const hideAllWindows = useLayoutStore((s) => s.hideAllWindows);
  const hasVisibleWindows = shown.length > 0;
  const newWindowSize = useLayoutStore((s) => s.newWindowSize);
  const setNewWindowSize = useLayoutStore((s) => s.setNewWindowSize);
  const [sizeOpen, setSizeOpen] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className={sectionHeading}>{t('tray.hiddenPanels', { count })}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSizeOpen((v) => !v)}
            aria-expanded={sizeOpen}
            title={t('tray.newSize')}
            aria-label={t('tray.newSize')}
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
            onClick={() => hideAllWindows(shown)}
            disabled={!hasVisibleWindows}
            className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="hide-all-windows"
          >
            {t('tray.hideAll')}
          </button>
        </div>
      </div>

      {count > 0 && !sizeOpen && (
        <p className="text-[11px] leading-snug text-neutral-500">{t('tray.restoreHint')}</p>
      )}

      {sizeOpen && (
        <div className="space-y-2 rounded-lg bg-neutral-50 p-2" data-testid="new-window-size">
          <label className="flex items-center gap-2 text-[11px] text-neutral-500">
            <span className="w-12 shrink-0">{t('tray.perRow')}</span>
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
              aria-label={t('tray.perRowLabel')}
            />
            <span className="w-4 text-right font-medium tabular-nums text-neutral-700">
              {newWindowSize.perRow}
            </span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-neutral-500">
            <span className="w-12 shrink-0">{t('tray.height')}</span>
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
              aria-label={t('tray.heightLabel')}
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
  const { t } = useTranslation('annotation');
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const showWindow = useLayoutStore((s) => s.showWindow);

  const inView = view ? collectionsInView(catalog, view) : [];
  const hiddenCollections = inView.filter((c) => currentLayout.hidden.includes(c.id));
  const shown = view ? windowsShown(catalog, view, currentLayout.hidden).map((c) => c.id) : [];

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
      title={t('layoutEdit.edit')}
      footerActions={footerActions}
      sections={
        (settingUpFirstView || isCampaignAdmin) && (
          <>
            {settingUpFirstView && (
              <div
                className="mb-2 rounded-md border border-brand-200 bg-brand-50 p-2 text-xs leading-snug text-brand-900"
                data-testid="first-view-setup-guidance"
              >
                <p className="mb-1 font-medium">{t('tray.setup.title')}</p>
                <p>
                  <Trans
                    t={t}
                    i18nKey="tray.setup.body"
                    components={{ strong: <span className="font-medium" /> }}
                  />
                </p>
                <p className="mt-2">{t('tray.setup.moveHint')}</p>
              </div>
            )}
            {isCampaignAdmin && <ViewAdmin />}
          </>
        )
      }
      pinnedSection={<NavigationPanels />}
      listHeader={<HiddenPanelsHeader count={items.length} shown={shown} />}
      storageKey="annotation:layoutPanel"
      onAdd={(id) => showWindow(Number(id))}
    />
  );
}

function NavigationPanels() {
  const { t } = useTranslation('annotation');
  const main = useLayoutStore((s) => s.currentLayout.main);
  const setPanel = useLayoutStore((s) => s.setNavigationPanel);
  const setOptions = useLayoutStore((s) => s.setPanelOptions);

  return (
    <div className="space-y-1 text-xs text-neutral-600">
      <h3 className={`${sectionHeading} mb-1.5`}>{t('navPanels.title')}</h3>
      {(['timeline', 'imagery'] as const).map((id) => {
        const item = main[id];
        return (
          <div key={id} className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5">
            <label className="flex min-w-0 cursor-pointer items-center gap-2 text-neutral-700">
              <input
                type="checkbox"
                checked={!!item}
                aria-label={t(`navPanels.${id}.separate`)}
                onChange={(e) => setPanel(id, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-600"
              />
              {t(`navPanels.${id}.checkbox`)}
            </label>
            <select
              aria-label={t(`navPanels.${id}.orientation`)}
              disabled={!item}
              value={item?.orientation ?? (id === 'timeline' ? 'vertical' : 'horizontal')}
              onChange={(e) =>
                setOptions(id, {
                  orientation: e.target.value === 'horizontal' ? 'horizontal' : 'vertical',
                })
              }
              className="h-6 w-24 shrink-0 rounded-md border border-neutral-200 bg-white px-1.5 text-[11px] text-neutral-600 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              <option value="horizontal">{t('navPanels.horizontal')}</option>
              <option value="vertical">{t('navPanels.vertical')}</option>
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
        {t('navPanels.sliceNavigation')}
      </label>
    </div>
  );
}
