import { useState } from 'react';
import type { ImagerySource, CollectionItem } from './types';
import { emptyManualCollection, swap } from './types';
import { CatalogBrowser } from './CatalogBrowser';
import { CollectionEditor } from './CollectionEditor';
import {
  IconTrash,
  IconChevronDown,
  IconChevronUp,
  IconStac,
  IconSettings,
  IconClock,
  IconPlus,
} from '~/shared/ui/Icons';
import { Modal } from '~/shared/ui/Modal';
import { Tooltip } from './Tooltip';

interface ImagerySourceEditorProps {
  source: ImagerySource;
  onChange: (updates: Partial<ImagerySource>) => void;
  onRemove: () => void;
}

export const ImagerySourceEditor = ({
  source,
  onChange,
  onRemove: _onRemove,
}: ImagerySourceEditorProps) => {
  const [showCatalogBrowser, setShowCatalogBrowser] = useState(false);
  const [catalogBrowserMode, setCatalogBrowserMode] = useState<'single' | 'temporal'>('temporal');
  const [showNewCollectionPicker, setShowNewCollectionPicker] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);

  const vizNames = source.visualizations.map((v) => v.name);

  const updateCollection = (id: string, updates: Partial<CollectionItem>) => {
    onChange({
      collections: source.collections.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    });
  };

  const removeCollection = (id: string) => {
    onChange({ collections: source.collections.filter((c) => c.id !== id) });
  };

  const addManualCollection = () => {
    const col = emptyManualCollection(vizNames);
    onChange({ collections: [...source.collections, col] });
    setShowNewCollectionPicker(false);
    setEditingCollectionId(col.id);
  };

  const handleCatalogBrowserAdd = (collections: CollectionItem[]) => {
    // Derive source-level visualizations from the stac_browser collection data
    const firstCol = collections[0];
    const newVizNames =
      firstCol?.data.type === 'stac_browser' && firstCol.data.visualizations
        ? firstCol.data.visualizations.map((v) => ({ name: v.name }))
        : undefined;

    const updates: Partial<ImagerySource> = {
      collections: [...source.collections, ...collections],
    };
    if (newVizNames && newVizNames.length > 0) {
      updates.visualizations = newVizNames;
    }
    onChange(updates);
    setShowCatalogBrowser(false);
  };

  const addVisualization = () => {
    onChange({
      visualizations: [...source.visualizations, { name: '' }],
    });
  };

  const removeVisualization = (index: number) => {
    const removed = source.visualizations[index].name;
    onChange({
      visualizations: source.visualizations.filter((_, i) => i !== index),
      collections: source.collections.map((c) => ({
        ...c,
        data: {
          ...c.data,
          vizUrls: c.data.vizUrls.filter((v) => v.vizName !== removed),
        },
      })),
    });
  };

  const renameVisualization = (index: number, newName: string) => {
    const oldName = source.visualizations[index].name;
    onChange({
      visualizations: source.visualizations.map((v, i) => (i === index ? { name: newName } : v)),
      collections: source.collections.map((c) => ({
        ...c,
        data: {
          ...c.data,
          vizUrls: c.data.vizUrls.map((vu) =>
            vu.vizName === oldName ? { ...vu, vizName: newName } : vu
          ),
        },
      })),
    });
  };

  const moveVisualization = (index: number, dir: -1 | 1) => {
    onChange({ visualizations: swap(source.visualizations, index, index + dir) });
  };

  return (
    <>
      <div className="space-y-4">
        {/* Zoom + Crosshair -compact inline row */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-neutral-700 flex items-center gap-1 shrink-0">
              Default Zoom
              <Tooltip text="Default zoom level for map windows using this source." />
            </label>
            <input
              type="number"
              min="1"
              max="22"
              value={source.defaultZoom}
              onChange={(e) => onChange({ defaultZoom: Number(e.target.value) })}
              className="w-14 border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs text-center"
            />
            {source.defaultZoom < 10 && (
              <span className="text-[10px] text-amber-600">
                Low zoom may be slow. Recommended: 10+
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-neutral-700 shrink-0">Crosshair</label>
            <div className="relative">
              <input
                type="color"
                value={`#${source.crosshairHex6}`}
                onChange={(e) => onChange({ crosshairHex6: e.target.value.replace('#', '') })}
                className="absolute opacity-0 w-5 h-5 cursor-pointer"
                id={`crosshair-${source.id}`}
              />
              <label
                htmlFor={`crosshair-${source.id}`}
                className="w-5 h-5 rounded-full border-2 border-neutral-300 cursor-pointer block"
                style={{ backgroundColor: `#${source.crosshairHex6}` }}
              />
            </div>
          </div>
        </div>

        {/* Visualization options (name only) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
              Visualization Options
              <Tooltip text="Named visualizations (e.g. True Color, NDVI). URLs are defined per-collection in STAC or Manual XYZ." />
            </label>
            <button
              type="button"
              onClick={addVisualization}
              className="text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
            >
              + Add
            </button>
          </div>
          {source.visualizations.map((viz, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="e.g. True Color"
                value={viz.name}
                onChange={(e) => renameVisualization(i, e.target.value)}
                className="flex-1 border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
              />
              <button
                type="button"
                onClick={() => moveVisualization(i, -1)}
                disabled={i === 0}
                className="text-neutral-400 hover:text-neutral-600 disabled:opacity-30 cursor-pointer disabled:cursor-default p-0.5"
                title="Move up"
              >
                <IconChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => moveVisualization(i, 1)}
                disabled={i === source.visualizations.length - 1}
                className="text-neutral-400 hover:text-neutral-600 disabled:opacity-30 cursor-pointer disabled:cursor-default p-0.5"
                title="Move down"
              >
                <IconChevronDown className="w-3 h-3" />
              </button>
              {source.visualizations.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeVisualization(i)}
                  className="text-red-400 hover:text-red-600 transition-colors cursor-pointer text-xs"
                >
                  <IconTrash className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Collections */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-neutral-700 flex items-center gap-1">
            Collections
            <Tooltip text="A collection is a time window of imagery (e.g. January 2024). Each collection contains slices (sub-periods like weeks) that annotators can switch between. Use 'Temporal Series' to auto-generate multiple collections from a date range, or 'Single Collection' to add one at a time." />
          </h4>

          {/* Collection tiles: dashed "add" tile first, then existing collections */}
          <div className="flex flex-wrap gap-2">
            {/* Add new collection tile */}
            <button
              type="button"
              onClick={() => setShowNewCollectionPicker(true)}
              className="flex items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 hover:border-brand-400 hover:bg-brand-50/30 transition-all cursor-pointer px-4 py-2.5 shrink-0"
            >
              <IconPlus className="w-4 h-4 text-neutral-400" />
            </button>

            {source.collections.map((collection) => {
              const displayName =
                collection.name ||
                (collection.slices.length > 0
                  ? `${collection.slices[0]?.startDate?.slice(0, 7) ?? ''} - ${collection.slices[collection.slices.length - 1]?.endDate?.slice(0, 7) ?? ''}`
                  : 'Untitled');
              const typeLabel =
                collection.data.type === 'stac'
                  ? 'STAC'
                  : collection.data.type === 'stac_browser'
                    ? 'Catalog'
                    : 'XYZ';
              return (
                <div
                  key={collection.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditingCollectionId(collection.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEditingCollectionId(collection.id);
                    }
                  }}
                  title="Click to configure"
                  className="group relative flex items-center justify-center rounded-lg border-2 transition-all cursor-pointer
                    px-3 py-2.5 shrink-0 border-neutral-200 bg-white text-neutral-800 hover:border-brand-400 hover:bg-brand-500/5"
                >
                  <IconSettings className="w-3 h-3 mr-1.5 shrink-0 transition-opacity opacity-0 group-hover:opacity-100 text-brand-600" />
                  <span className="text-xs font-medium leading-tight truncate max-w-[120px]">
                    {displayName}
                  </span>
                  <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded shrink-0 bg-neutral-100 text-neutral-500">
                    {typeLabel}
                  </span>
                  {collection.slices.length > 1 && (
                    <span className="ml-1 text-[9px] shrink-0 flex items-center gap-0.5 text-neutral-400">
                      <IconClock className="w-2.5 h-2.5" />
                      {collection.slices.length}
                    </span>
                  )}
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCollection(collection.id);
                    }}
                    className="ml-1.5 shrink-0 transition-opacity p-0.5 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100"
                    title="Remove collection"
                  >
                    <IconTrash className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* New collection picker modal */}
      {showNewCollectionPicker && (
        <Modal title="Add Collection" onClose={() => setShowNewCollectionPicker(false)}>
          <div className="p-3 space-y-1.5">
            <p className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold px-1 pt-0.5 pb-1">
              From STAC Catalog
            </p>
            <button
              type="button"
              onClick={() => {
                setCatalogBrowserMode('temporal');
                setShowCatalogBrowser(true);
                setShowNewCollectionPicker(false);
              }}
              className="w-full text-left px-4 py-3.5 rounded-lg bg-brand-50 border border-brand-200 hover:bg-brand-100 cursor-pointer transition-colors"
            >
              <span className="text-sm font-semibold text-brand-700 flex items-center gap-1.5">
                <IconStac className="w-3.5 h-3.5 text-brand-500" />
                Temporal Series
                <span className="ml-auto text-[10px] font-medium bg-brand-500 text-white px-1.5 py-0.5 rounded-full">
                  Recommended
                </span>
              </span>
              <p className="text-xs text-brand-600/70 mt-1">
                Auto-generate multiple collections from a date range. Each collection covers a time
                window (e.g. one month) and is split into slices (e.g. weeks) for annotators to
                browse.
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                setCatalogBrowserMode('single');
                setShowCatalogBrowser(true);
                setShowNewCollectionPicker(false);
              }}
              className="w-full text-left px-4 py-3 rounded-lg border border-neutral-200 hover:border-brand-300 hover:bg-brand-50/30 cursor-pointer transition-colors"
            >
              <span className="text-sm font-medium text-neutral-800 flex items-center gap-1.5">
                <IconStac className="w-3.5 h-3.5 text-neutral-500" />
                Single Collection
              </span>
              <p className="text-xs text-neutral-500 mt-0.5">
                Add a single collection with its own slices from a STAC catalog. Use this when you
                need just one time window instead of a full temporal series.
              </p>
            </button>

            <div className="border-t border-neutral-100 my-1.5" />
            <p className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold px-1 pt-0.5 pb-1">
              Manual
            </p>
            <button
              type="button"
              onClick={addManualCollection}
              className="w-full text-left px-4 py-3 rounded-lg hover:bg-neutral-50 cursor-pointer transition-colors"
            >
              <span className="text-sm font-medium text-neutral-800">XYZ Tile URL</span>
              <p className="text-xs text-neutral-500 mt-0.5">
                Create a Collection from XYZ urls. Each slice is a direct XYZ tile URL (e.g. from a
                custom tile server) without search semantics.
              </p>
            </button>
          </div>
        </Modal>
      )}

      {/* Collection editor modal */}
      {editingCollectionId && source.collections.find((c) => c.id === editingCollectionId) && (
        <Modal
          title="Edit Collection"
          onClose={() => setEditingCollectionId(null)}
          maxWidth="max-w-xl"
          scrollable
        >
          <CollectionEditor
            collection={source.collections.find((c) => c.id === editingCollectionId)!}
            vizNames={vizNames}
            onChange={(updates) => updateCollection(editingCollectionId, updates)}
            onRemove={() => {
              removeCollection(editingCollectionId);
              setEditingCollectionId(null);
            }}
            inModal
          />
        </Modal>
      )}

      {showCatalogBrowser && (
        <CatalogBrowser
          initialMode="mosaic"
          singleCollection={catalogBrowserMode === 'single'}
          onAdd={handleCatalogBrowserAdd}
          onClose={() => setShowCatalogBrowser(false)}
        />
      )}
    </>
  );
};
