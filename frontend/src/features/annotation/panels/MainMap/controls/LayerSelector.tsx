import { type Catalog, type SliceAddress } from '../../../campaign/catalog';
import { restoreSnapshot } from '../../../campaign/imageryNav';
import { useImageryStore } from '../../../stores/imagery';
import { HeaderSelect, type HeaderSelectOption } from '../../../components/HeaderSelect';
import { rememberLastAddress } from '../../../bindings';

const BASEMAP_PREFIX = 'basemap-';

/** Staying on the current collection when only the visualization changes is
 *  what makes I/Shift+I feel like a filter rather than a jump. */
function addressFor(
  catalog: Catalog,
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
  catalog: Catalog;
  sourceIds: number[];
  /** Tooltip carrying the source/visualization hotkeys, from the bindings. */
  title: string;
}

export function LayerSelector({ catalog, sourceIds, title }: LayerSelectorProps) {
  const address = useImageryStore((s) => s.address);
  const showBasemap = useImageryStore((s) => s.showBasemap);
  const selectedBasemapId = useImageryStore((s) => s.selectedBasemapId);
  const setAddress = useImageryStore((s) => s.setAddress);
  const setShowBasemap = useImageryStore((s) => s.setShowBasemap);
  const setSelectedBasemapId = useImageryStore((s) => s.setSelectedBasemapId);

  const options: HeaderSelectOption[] = [];
  const sources = sourceIds.map((id) => catalog.sources.get(id)).filter((s) => s !== undefined);
  const showSourceName = sources.length > 1;

  for (const source of sources) {
    for (const viz of source.visualizations) {
      options.push({
        value: `${source.id}:${viz.id}`,
        label: showSourceName ? `${source.name} > ${viz.name}` : viz.name,
      });
    }
  }
  for (const basemap of catalog.basemaps.values()) {
    options.push({ value: `${BASEMAP_PREFIX}${basemap.id}`, label: basemap.name });
  }
  if (options.length === 0) return null;

  const value = showBasemap
    ? (selectedBasemapId ?? '')
    : address
      ? `${address.sourceId}:${address.vizId}`
      : '';

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

  return (
    <div data-tour="layer-selector">
      <HeaderSelect
        value={value}
        options={options}
        onChange={handleChange}
        title={title}
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
