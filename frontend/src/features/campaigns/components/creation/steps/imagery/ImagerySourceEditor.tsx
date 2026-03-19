import { useState, useEffect } from 'react';
import type { ImagerySource, CollectionItem } from './types';
import { emptyManualCollection, emptyStacCollection, swap } from './types';
import { CollectionEditor } from './CollectionEditor';
import { StacGenerator } from './StacGenerator';
import { IconTrash, IconChevronDown, IconChevronUp, IconStac, IconSettings, IconClock, IconPlus, IconClose } from '~/shared/ui/Icons';
import { Modal } from '~/shared/ui/Modal';
import { Tooltip } from './Tooltip';

interface ImagerySourceEditorProps {
  source: ImagerySource;
  onChange: (updates: Partial<ImagerySource>) => void;
  onRemove: () => void;
  /** When set, auto-opens the StacGenerator with this preset pre-applied */
  initialPresetId?: string | null;
  /** Called when the initial preset has been consumed (so parent can clear it) */
  onPresetConsumed?: () => void;
}

export const ImagerySourceEditor = ({ source, onChange, onRemove, initialPresetId, onPresetConsumed }: ImagerySourceEditorProps) => {
  const [showStacGenerator, setShowStacGenerator] = useState(false);
  const [showNewCollectionPicker, setShowNewCollectionPicker] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);

  // Auto-open StacGenerator when a preset source is created
  useEffect(() => {
    if (initialPresetId) {
      setShowStacGenerator(true);
    }
  }, [initialPresetId]);

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

  const addSingleStacCollection = () => {
    const col = emptyStacCollection(vizNames);
    onChange({ collections: [...source.collections, col] });
    setShowNewCollectionPicker(false);
    setEditingCollectionId(col.id);
  };

  const handleStacGenerate = (collections: CollectionItem[]) => {
    onChange({ collections: [...source.collections, ...collections] });
    setShowStacGenerator(false);
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
      visualizations: source.visualizations.map((v, i) =>
        i === index ? { name: newName } : v,
      ),
      collections: source.collections.map((c) => ({
        ...c,
        data: {
          ...c.data,
          vizUrls: c.data.vizUrls.map((vu) =>
            vu.vizName === oldName ? { ...vu, vizName: newName } : vu,
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
          <h4 className="text-xs font-medium text-neutral-700">Collections</h4>

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
              const displayName = collection.name || (collection.slices.length > 0 ? `${collection.slices[0]?.startDate?.slice(0, 7) ?? ''} - ${collection.slices[collection.slices.length - 1]?.endDate?.slice(0, 7) ?? ''}` : 'Untitled');
              const typeLabel = collection.data.type === 'stac' ? 'STAC' : 'XYZ';
              return (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => setEditingCollectionId(collection.id)}
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
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* New collection picker modal */}
      {showNewCollectionPicker && (
        <Modal title="Add Collection" onClose={() => setShowNewCollectionPicker(false)}>
            <div className="p-3 space-y-1">
              <button
                type="button"
                onClick={() => { setShowStacGenerator(true); setShowNewCollectionPicker(false); }}
                className="w-full text-left px-4 py-3.5 rounded-lg bg-brand-50 border border-brand-200 hover:bg-brand-100 cursor-pointer transition-colors"
              >
                <span className="text-sm font-semibold text-brand-700 flex items-center gap-1.5">
                  <IconStac className="w-3.5 h-3.5 text-brand-500" />
                  STAC Temporal Series
                  <span className="ml-auto text-[10px] font-medium bg-brand-500 text-white px-1.5 py-0.5 rounded-full">Recommended</span>
                </span>
                <p className="text-xs text-brand-600/70 mt-0.5">
                  Auto-generate multiple collections from a time range and period interval.
                </p>
              </button>
              <button
                type="button"
                onClick={addSingleStacCollection}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                <span className="text-sm font-medium text-neutral-800 flex items-center gap-1.5">
                  <IconStac className="w-3.5 h-3.5 text-neutral-500" />
                  Single STAC Collection
                </span>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Add one STAC collection with its own registration and search config.
                </p>
              </button>
              <button
                type="button"
                onClick={addManualCollection}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                <span className="text-sm font-medium text-neutral-800">Manual XYZ</span>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Add a collection with direct XYZ tile URLs.
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
                onRemove={() => { removeCollection(editingCollectionId); setEditingCollectionId(null); }}
                inModal
              />
        </Modal>
      )}

      {showStacGenerator && (
        <StacGenerator
          vizNames={vizNames}
          onGenerate={handleStacGenerate}
          onClose={() => { setShowStacGenerator(false); onPresetConsumed?.(); }}
          initialPresetId={initialPresetId}
        />
      )}
    </>
  );
};
