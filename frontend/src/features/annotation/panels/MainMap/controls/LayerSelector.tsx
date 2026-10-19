import { useId } from 'react';
import { useLayoutStore } from '../../../stores/layout';
import { type ImageryCatalog } from '../../../campaign/imagery';
import { type SliceAddress } from '../../../campaign/imageryNav';
import { restoreSnapshot } from '../../../campaign/imageryNav';
import { useImageryStore } from '../../../stores/imagery';
import { HeaderSelect, type HeaderSelectOption } from '../../../components/HeaderSelect';
import { rememberLastAddress } from '../../../keymap';

const BASEMAP_PREFIX = 'basemap-';

/** Staying on the current collection when only the visualization changes is
 *  what makes I/Shift+I feel like a filter rather than a jump. */
function addressFor(
  catalog: ImageryCatalog,
  sourceId: number,
  vizId: string,
  current: SliceAddress | null
): SliceAddress | null {
  if (current && current.sourceId === sourceId) return { ...current, vizId };
  const collectionId = catalog.sources.get(sourceId)?.collections[0]?.id;
  if (collectionId == null) return null;
  const base = restoreSnapshot(catalog, undefined, collectionId).address;
  return base ? { ...base, vizId } : null;
}

export interface LayerSelectorProps {
  catalog: ImageryCatalog;
  sourceIds: number[];
  /** Tooltip carrying the source/visualization hotkeys, from the bindings. */
  title: string;
  expanded?: boolean;
}

export function LayerSelector({ catalog, sourceIds, title, expanded = false }: LayerSelectorProps) {
  const radioName = useId();
  const forcedOpen = useLayoutStore((s) => s.forcedOpenControl);
  const address = useImageryStore((s) => s.address);
  const showBasemap = useImageryStore((s) => s.showBasemap);
  const selectedBasemapId = useImageryStore((s) => s.selectedBasemapId);
  const setAddress = useImageryStore((s) => s.setAddress);
  const setShowBasemap = useImageryStore((s) => s.setShowBasemap);
  const setSelectedBasemapId = useImageryStore((s) => s.setSelectedBasemapId);

  const sources = sourceIds.map((id) => catalog.sources.get(id)).filter((s) => s !== undefined);
  if (!sources.some((source) => source.visualizations.length > 0) && catalog.basemaps.size === 0)
    return null;

  const handleChange = (next: string | number) => {
    const key = String(next);
    rememberLastAddress(address);
    if (key.startsWith(BASEMAP_PREFIX)) {
      setSelectedBasemapId(key);
      setShowBasemap(true);
      return;
    }
    const [sourceId, vizId] = key.split(':');
    const target = addressFor(catalog, Number(sourceId), vizId, address);
    if (!target) return;
    setAddress(target);
    setShowBasemap(false);
  };

  if (expanded) {
    return (
      <div data-tour="layer-selector" className="select-none">
        <div className="text-[11px] font-medium text-neutral-500">Imagery sources</div>
        <div role="radiogroup" aria-label="Imagery sources" className="space-y-1 p-0.5">
          {sources.map((source) => {
            const viz =
              source.visualizations.find((item) => String(item.id) === address?.vizId) ??
              source.visualizations[0];
            if (!viz) return null;
            const active = !showBasemap && address?.sourceId === source.id;
            return (
              <div key={source.id}>
                <label
                  className={`flex min-w-0 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] ${active ? 'font-medium text-brand-700' : 'text-neutral-700 hover:bg-neutral-50'}`}
                >
                  <input
                    type="radio"
                    name={radioName}
                    checked={active}
                    onChange={() => handleChange(`${source.id}:${viz.id}`)}
                    className="h-3 w-3 shrink-0 cursor-pointer accent-brand-600"
                  />
                  <span className="truncate" title={source.name}>
                    {source.name}
                  </span>
                </label>
                <div
                  role="group"
                  aria-label={`${source.name} visualizations`}
                  className="flex flex-wrap gap-0.5 pl-5"
                >
                  {source.visualizations.map((item) => {
                    const selected = active && String(item.id) === address?.vizId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => handleChange(`${source.id}:${item.id}`)}
                        className={`rounded px-1.5 py-0.5 text-[10px] cursor-pointer ${selected ? 'bg-brand-50 font-medium text-brand-700' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'}`}
                      >
                        {item.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {[...catalog.basemaps.values()].map((basemap) => (
            <label
              key={`basemap-${basemap.id}`}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-50"
            >
              <input
                type="radio"
                name={radioName}
                checked={showBasemap && selectedBasemapId === `${BASEMAP_PREFIX}${basemap.id}`}
                onChange={() => handleChange(`${BASEMAP_PREFIX}${basemap.id}`)}
                className="h-3 w-3 shrink-0 cursor-pointer accent-brand-600"
              />
              <span className="truncate" title={basemap.name}>
                {basemap.name}
              </span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  const options: HeaderSelectOption[] = sources.flatMap((source) =>
    source.visualizations.map((viz) => ({
      value: `${source.id}:${viz.id}`,
      label: viz.name,
      group: source.name,
    }))
  );
  for (const basemap of catalog.basemaps.values()) {
    options.push({
      value: `${BASEMAP_PREFIX}${basemap.id}`,
      label: basemap.name,
      group: 'Basemaps',
    });
  }
  const value = showBasemap
    ? (selectedBasemapId ?? '')
    : address
      ? `${address.sourceId}:${address.vizId}`
      : '';

  return (
    <div data-tour="layer-selector">
      <HeaderSelect
        value={value}
        options={options}
        onChange={handleChange}
        title={title}
        forcedOpen={forcedOpen === 'layer-selector'}
        menuTourName="layer-selector-menu"
        icon={
          <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 2L2 6L10 10L18 6L10 2Z" />
            <path d="M2 10L10 14L18 10" />
            <path d="M2 14L10 18L18 14" />
          </svg>
        }
      />
    </div>
  );
}
