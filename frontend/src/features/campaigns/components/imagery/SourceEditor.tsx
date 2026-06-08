import { useState } from 'react';
import { Modal } from '~/shared/ui/Modal';
import {
  IconTrash,
  IconChevronDown,
  IconChevronUp,
  IconSettings,
  IconClock,
  IconPlus,
} from '~/shared/ui/Icons';
import type { CollectionItem, ImagerySource, NamedVizParams } from './types';
import { emptyManualCollection, emptyVizParams, swap } from './types';
import { IconButton, Input, Button } from '~/shared/ui/forms';
import { Tooltip } from '~/shared/ui/Tooltip';
import { CollectionEditor } from './CollectionEditor';
import { CatalogBrowser, MPC_PRESETS } from './CatalogBrowser';
import type { CatalogBrowserPreset } from './CatalogBrowser';
import { BulkApplyModal } from './BulkApplyModal';
import type { BulkFocus } from './BulkApplyModal';
import type { ImageryController } from './controller';

interface SourceEditorProps {
  source: ImagerySource;
  controller: ImageryController;
  onClose: () => void;
  campaignBbox?: number[] | null;
}

type AddCollectionStep =
  | null
  | { kind: 'pick' }
  | { kind: 'catalog'; preset: CatalogBrowserPreset | null };

const collectionDisplayName = (c: CollectionItem) => {
  if (c.name) return c.name;
  if (c.slices.length === 0) return 'Untitled';
  const first = c.slices[0]?.startDate?.slice(0, 7) ?? '';
  const last = c.slices[c.slices.length - 1]?.endDate?.slice(0, 7) ?? '';
  return `${first} - ${last}`;
};

/** Apply a visualization-name rewrite to every collection's vizUrls (in `data`
 * and per-slice). A null target means the viz was removed and its URLs are
 * dropped. */
function rewriteVizUrls(
  collections: CollectionItem[],
  rewrite: (vizName: string) => string | null
): CollectionItem[] {
  const filter = <T extends { vizName: string }>(arr: T[]) =>
    arr
      .map((vu) => {
        const next = rewrite(vu.vizName);
        return next === null ? null : { ...vu, vizName: next };
      })
      .filter((v): v is T => v !== null);

  return collections.map((c) => ({
    ...c,
    data: { ...c.data, vizUrls: filter(c.data.vizUrls) },
    slices: c.slices.map((sl) => (sl.vizUrls ? { ...sl, vizUrls: filter(sl.vizUrls) } : sl)),
  }));
}

/** Align a freshly-added collection to the source's visualization names so it
 * exposes the same named tabs. Params for a matching name are carried over;
 * names the source has but the collection lacks become empty tabs ready to fill;
 * extra names from the catalog that the source doesn't have are dropped. */
function alignCollectionToVizNames(c: CollectionItem, vizNames: string[]): CollectionItem {
  if (c.data.type !== 'stac_browser' || vizNames.length === 0) return c;
  const data = c.data;
  const byName = new Map(data.visualizations.map((v) => [v.name, v]));
  const visualizations: NamedVizParams[] = vizNames.map(
    (name) => byName.get(name) ?? { name, vizParams: emptyVizParams() }
  );
  let coverVisualizations = data.coverVisualizations;
  if (coverVisualizations) {
    const coverByName = new Map(coverVisualizations.map((v) => [v.name, v]));
    coverVisualizations = vizNames.map(
      (name) =>
        coverByName.get(name) ?? { name, vizParams: { ...emptyVizParams(), compositing: 'first' } }
    );
  }
  const vizUrls = vizNames.map(
    (name) => data.vizUrls.find((u) => u.vizName === name) ?? { vizName: name, url: '' }
  );
  return { ...c, data: { ...data, visualizations, coverVisualizations, vizUrls } };
}

export const SourceEditor = ({
  source,
  controller,
  onClose,
  campaignBbox = null,
}: SourceEditorProps) => {
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [addStep, setAddStep] = useState<AddCollectionStep>(null);
  const [bulkFocus, setBulkFocus] = useState<BulkFocus | null>(null);

  const vizNames = source.visualizations.map((v) => v.name);
  const hasStac = source.collections.some((c) => c.data.type === 'stac_browser');
  const updateSource = (patch: Partial<ImagerySource>) => controller.updateSource(source.id, patch);

  const handleRemoveSource = async () => {
    if (controller.mode === 'persisted') {
      const ok = window.confirm(
        `Delete imagery source "${source.name || 'Untitled'}"?\n\nThis cannot be undone.`
      );
      if (!ok) return;
    }
    await controller.removeSource(source.id);
    onClose();
  };

  const addManualCollection = () => {
    const col = emptyManualCollection(vizNames);
    void controller.addCollection(source.id, col);
    setAddStep(null);
    setEditingCollectionId(col.id);
  };

  const renameVisualization = (index: number, newName: string) => {
    const oldName = source.visualizations[index].name;
    void updateSource({
      visualizations: source.visualizations.map((v, i) => (i === index ? { name: newName } : v)),
      collections: rewriteVizUrls(source.collections, (n) => (n === oldName ? newName : n)),
    });
  };

  const removeVisualization = (index: number) => {
    const removed = source.visualizations[index].name;
    void updateSource({
      visualizations: source.visualizations.filter((_, i) => i !== index),
      collections: rewriteVizUrls(source.collections, (n) => (n === removed ? null : n)),
    });
  };

  const addCollectionsFromCatalog = async (collections: CollectionItem[]) => {
    for (const c of collections) {
      // Align to the source's viz names so the new collection shows the same
      // named tabs (waiting to be filled) as the rest of the source.
      await controller.addCollection(source.id, alignCollectionToVizNames(c, vizNames));
    }
    setAddStep(null);
  };

  if (bulkFocus) {
    return (
      <BulkApplyModal
        source={source}
        controller={controller}
        focus={bulkFocus}
        onClose={() => setBulkFocus(null)}
      />
    );
  }

  if (addStep?.kind === 'catalog') {
    return (
      <CatalogBrowser
        preset={addStep.preset}
        initialMode="mosaic"
        campaignBbox={campaignBbox}
        initialAdvanced={controller.mode === 'persisted'}
        onAdd={(cols) => void addCollectionsFromCatalog(cols)}
        onClose={() => setAddStep(null)}
      />
    );
  }

  if (addStep?.kind === 'pick') {
    return (
      <Modal title="Add collection" onClose={() => setAddStep(null)}>
        <div className="p-3 space-y-1.5">
          <p className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold px-1 pt-0.5 pb-1">
            From STAC catalog
          </p>
          {MPC_PRESETS.map((preset) => (
            <button
              key={preset.stacCollectionId}
              type="button"
              onClick={() => setAddStep({ kind: 'catalog', preset })}
              className="w-full text-left px-3 py-2 rounded-md hover:bg-brand-50/30 cursor-pointer transition-colors"
            >
              <span className="text-sm text-neutral-800">{preset.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAddStep({ kind: 'catalog', preset: null })}
            className="w-full text-left px-3 py-2 rounded-md hover:bg-brand-50/30 cursor-pointer transition-colors"
          >
            <span className="text-sm text-neutral-800">Other STAC catalog…</span>
          </button>
          <div className="border-t border-neutral-100 my-1.5" />
          <p className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold px-1 pt-0.5 pb-1">
            Manual
          </p>
          <button
            type="button"
            onClick={addManualCollection}
            className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50 cursor-pointer transition-colors"
          >
            <span className="text-sm text-neutral-800">XYZ tile URL</span>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              A direct tile server URL with {'{z}/{x}/{y}'} placeholders. No STAC search semantics.
            </p>
          </button>
        </div>
      </Modal>
    );
  }

  const editingCollection = editingCollectionId
    ? source.collections.find((c) => c.id === editingCollectionId)
    : null;
  if (editingCollection) {
    const closeCollection = () => setEditingCollectionId(null);
    return (
      <Modal
        title="Edit collection"
        onClose={closeCollection}
        maxWidth="max-w-xl"
        scrollable
        footer={
          <div className="flex items-center justify-between">
            <Button variant="primary" size="sm" onClick={closeCollection}>
              Done
            </Button>
          </div>
        }
      >
        <CollectionEditor
          collection={editingCollection}
          vizNames={vizNames}
          onChange={(updates) =>
            controller.updateCollection(source.id, editingCollection.id, updates)
          }
          onRemove={() => {
            void controller.removeCollection(source.id, editingCollection.id);
            closeCollection();
          }}
          inModal
        />
      </Modal>
    );
  }

  return (
    <Modal
      title="Edit source"
      onClose={onClose}
      maxWidth="max-w-xl"
      scrollable
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void handleRemoveSource()}
            className="text-xs text-red-500 hover:text-red-700 transition-colors cursor-pointer"
          >
            Delete source
          </button>
          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Name</label>
          <Input
            size="sm"
            type="text"
            value={source.name}
            onChange={(e) => void updateSource({ name: e.target.value })}
            placeholder="Source name…"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-neutral-700 flex items-center gap-1 shrink-0">
              Default zoom
              <Tooltip text="Default zoom level for map windows using this source." />
            </label>
            <Input
              size="sm"
              type="number"
              min="1"
              max="22"
              value={source.defaultZoom}
              onChange={(e) => void updateSource({ defaultZoom: Number(e.target.value) })}
              className="!w-14 text-center"
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
                onChange={(e) =>
                  void updateSource({ crosshairHex6: e.target.value.replace('#', '') })
                }
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
              Visualization options
              <Tooltip text="Named visualizations (e.g. True Color, NDVI). URLs are defined per-collection." />
            </label>
            <button
              type="button"
              onClick={() =>
                void updateSource({ visualizations: [...source.visualizations, { name: '' }] })
              }
              className="text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
            >
              + Add
            </button>
          </div>
          {source.visualizations.map((viz, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                size="sm"
                type="text"
                placeholder="e.g. True Color"
                value={viz.name}
                onChange={(e) => renameVisualization(i, e.target.value)}
                className="flex-1"
              />
              {hasStac && viz.name && (
                <IconButton
                  tone="brand"
                  onClick={() => setBulkFocus({ kind: 'viz', name: viz.name })}
                  title="Edit this visualization's params for all collections"
                  aria-label={`Edit ${viz.name} params for all collections`}
                >
                  <IconSettings className="w-3.5 h-3.5" />
                </IconButton>
              )}
              <button
                type="button"
                onClick={() =>
                  void updateSource({ visualizations: swap(source.visualizations, i, i - 1) })
                }
                disabled={i === 0}
                className="text-neutral-400 hover:text-neutral-600 disabled:opacity-30 cursor-pointer disabled:cursor-default p-0.5"
                title="Move up"
              >
                <IconChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() =>
                  void updateSource({ visualizations: swap(source.visualizations, i, i + 1) })
                }
                disabled={i === source.visualizations.length - 1}
                className="text-neutral-400 hover:text-neutral-600 disabled:opacity-30 cursor-pointer disabled:cursor-default p-0.5"
                title="Move down"
              >
                <IconChevronDown className="w-3 h-3" />
              </button>
              {source.visualizations.length > 1 && (
                <IconButton
                  tone="danger"
                  onClick={() => removeVisualization(i)}
                  aria-label="Remove visualization"
                >
                  <IconTrash className="w-3 h-3" />
                </IconButton>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-neutral-700 flex items-center gap-1">
              Collections
              <Tooltip text="A collection is a time window of imagery. Each collection contains slices annotators can switch between." />
            </h4>
            {hasStac && (
              <button
                type="button"
                onClick={() => setBulkFocus({ kind: 'search' })}
                className="text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
              >
                Search settings · all collections
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAddStep({ kind: 'pick' })}
              className="flex items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 hover:border-brand-400 hover:bg-brand-50/30 transition-all cursor-pointer px-4 py-2.5 shrink-0"
            >
              <IconPlus className="w-4 h-4 text-neutral-400" />
            </button>

            {source.collections.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setEditingCollectionId(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditingCollectionId(c.id);
                  }
                }}
                className="group relative flex items-center justify-center rounded-lg border-2 transition-all cursor-pointer px-3 py-2.5 pr-7 shrink-0 border-neutral-200 bg-white text-neutral-800 hover:border-brand-400 hover:bg-brand-700/5"
              >
                <IconSettings className="w-3 h-3 mr-1.5 shrink-0 transition-opacity opacity-0 group-hover:opacity-100 text-brand-600" />
                <span className="text-xs font-medium leading-tight truncate max-w-[120px]">
                  {collectionDisplayName(c)}
                </span>
                {c.slices.length > 1 && (
                  <span className="ml-1 text-[9px] shrink-0 flex items-center gap-0.5 text-neutral-400">
                    <IconClock className="w-2.5 h-2.5" />
                    {c.slices.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void controller.removeCollection(source.id, c.id);
                  }}
                  title={`Delete collection "${collectionDisplayName(c)}"`}
                  aria-label={`Delete collection ${collectionDisplayName(c)}`}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <IconTrash className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
