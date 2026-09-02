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
import type { CatalogBrowserPreset, CatalogBrowserResult } from './CatalogBrowser';
import { BulkApplyModal } from './BulkApplyModal';
import type { BulkFocus } from './BulkApplyModal';
import type { ImageryController } from './controller';
import { sourceRegistration } from './controller';
import { ApiKeyField } from './ApiKeyField';
import { isRealId } from './draftSync';
import { setSourceApiKey } from '~/api/client';
import {
  editableGenerationSeries,
  retainMatchingIds,
  type EditableGenerationSeries,
} from './generation';

interface SourceEditorProps {
  source: ImagerySource;
  controller: ImageryController;
  onClose: () => void;
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

/**
 * How much of this source is actually registered, and the way to re-run its
 * searches. Registration happens per campaign but succeeds per source, so a
 * source with no tiles is invisible in the campaign-wide status.
 */
function SourceRegistration({
  controller,
  source,
}: {
  controller: ImageryController;
  source: ImagerySource;
}) {
  const registration = sourceRegistration(source, controller.campaignId);
  if (!registration) return null;

  const { registered, total, percent, complete } = registration;

  return (
    <div className="space-y-1" data-testid="source-registration">
      <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
        Registration
        <Tooltip text="Slices become visible once their imagery is registered with the tiler. Re-register to run this source's searches again - use it when a season has moved on and newer imagery should be picked up." />
      </label>
      <div className="flex items-center gap-3">
        <span className={`text-[11px] ${complete ? 'text-green-700' : 'text-amber-600'}`}>
          {registered} of {total} slices registered ({percent}%)
        </span>
        {source.refreshable && (
          <button
            type="button"
            onClick={() => void controller.refreshSource(source.id)}
            disabled={controller.pending}
            data-testid="re-register-source"
            className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {controller.pending ? 'Working…' : 'Re-register imagery'}
          </button>
        )}
      </div>
    </div>
  );
}

export const SourceEditor = ({ source, controller, onClose }: SourceEditorProps) => {
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [addStep, setAddStep] = useState<AddCollectionStep>(null);
  const [bulkFocus, setBulkFocus] = useState<BulkFocus | null>(null);
  const [generationStep, setGenerationStep] = useState<'warning' | 'editing' | null>(null);
  const [generationTargetId, setGenerationTargetId] = useState<string | null>(null);
  const [preserveOtherCollections, setPreserveOtherCollections] = useState(true);

  const vizNames = source.visualizations.map((v) => v.name);
  const hasStac = source.collections.some((c) => c.data.type === 'stac_browser');
  // A manual collection URL using {api_key} means this source needs a server-side provider key.
  const sourceNeedsApiKey = source.collections.some(
    (c) =>
      c.data.type === 'manual' &&
      (c.data.vizUrls.some((u) => u.url.includes('{api_key}')) ||
        c.slices.some((sl) => sl.vizUrls?.some((u) => u.url.includes('{api_key}'))))
  );
  const updateSource = (patch: Partial<ImagerySource>) => controller.updateSource(source.id, patch);
  const generationSeries = editableGenerationSeries(source);
  const activeGenerationSeries = generationSeries.find(
    (series) => series.id === generationTargetId
  );

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

  const addCollectionsFromCatalog = async (result: CatalogBrowserResult) => {
    const collections = result.collections.map((collection) =>
      alignCollectionToVizNames(collection, vizNames)
    );
    await updateSource({
      collections: [...source.collections, ...collections],
      generationSeries: result.generationSeries
        ? [...source.generationSeries, result.generationSeries]
        : source.generationSeries,
    });
    setAddStep(null);
  };

  const openGenerationEditor = (series: EditableGenerationSeries) => {
    setGenerationTargetId(series.id);
    setPreserveOtherCollections(true);
    setGenerationStep(series.otherCollections.length > 0 ? 'warning' : 'editing');
  };

  const replaceGeneratedSeries = async (
    result: CatalogBrowserResult,
    series: EditableGenerationSeries
  ) => {
    const generated = result.collections;
    if (generated.length === 0) return;
    const replacements = retainMatchingIds(
      generated.map((collection) => alignCollectionToVizNames(collection, vizNames)),
      series.collections
    );
    const replacedIds = new Set(series.collections.map((c) => c.id));

    let collections: CollectionItem[];
    if (!preserveOtherCollections) {
      collections = replacements;
    } else {
      collections = [];
      let inserted = false;
      for (const collection of source.collections) {
        if (replacedIds.has(collection.id)) {
          if (!inserted) {
            collections.push(...replacements);
            inserted = true;
          }
        } else {
          collections.push(collection);
        }
      }
      if (!inserted) collections.push(...replacements);
    }

    await updateSource({
      collections,
      generationSeries: preserveOtherCollections
        ? source.generationSeries.map((candidate) =>
            candidate.id === series.id ? (result.generationSeries ?? candidate) : candidate
          )
        : [result.generationSeries ?? source.generationSeries.find((s) => s.id === series.id)!],
    });
    setGenerationStep(null);
    setGenerationTargetId(null);
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
        projectId={controller.projectId}
        preset={addStep.preset}
        initialMode="mosaic"
        campaignBbox={controller.campaignBbox}
        initialAdvanced={controller.mode === 'persisted'}
        onAdd={(result) => void addCollectionsFromCatalog(result)}
        onClose={() => setAddStep(null)}
      />
    );
  }

  if (generationStep === 'editing' && activeGenerationSeries) {
    return (
      <CatalogBrowser
        projectId={controller.projectId}
        initialMode="mosaic"
        campaignBbox={controller.campaignBbox}
        initialAdvanced={controller.mode === 'persisted'}
        initialGeneration={activeGenerationSeries.config}
        generationSeriesId={activeGenerationSeries.id}
        onAdd={(result) => void replaceGeneratedSeries(result, activeGenerationSeries)}
        onClose={() => setGenerationStep(null)}
      />
    );
  }

  if (generationStep === 'warning' && activeGenerationSeries) {
    const count = activeGenerationSeries.otherCollections.length;
    return (
      <Modal
        title="Collections outside this generated series"
        onClose={() => setGenerationStep(null)}
        maxWidth="max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setGenerationStep(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => setGenerationStep('editing')}>
              Continue
            </Button>
          </div>
        }
      >
        <div className="p-4 space-y-3 text-sm text-neutral-700">
          <p>
            {count} collection{count === 1 ? '' : 's'} in this source {count === 1 ? 'is' : 'are'}
            not part of the generated series you are editing. Choose what regeneration should do
            with {count === 1 ? 'it' : 'them'}.
          </p>
          <label className="flex items-start gap-2 rounded-md border border-brand-200 bg-brand-50/40 p-3 cursor-pointer">
            <input
              type="radio"
              name="non-generated-collections"
              checked={preserveOtherCollections}
              onChange={() => setPreserveOtherCollections(true)}
              className="mt-0.5"
            />
            <span>
              <strong className="block text-neutral-800">Keep them</strong>
              <span className="text-xs text-neutral-500">
                Recommended. Replace only this generated series and leave the other collections in
                place.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-3 cursor-pointer">
            <input
              type="radio"
              name="non-generated-collections"
              checked={!preserveOtherCollections}
              onChange={() => setPreserveOtherCollections(false)}
              className="mt-0.5"
            />
            <span>
              <strong className="block text-neutral-800">Remove them</strong>
              <span className="text-xs text-neutral-500">
                Replace every collection in this source with the newly generated series.
              </span>
            </span>
          </label>
        </div>
      </Modal>
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
          projectId={controller.projectId}
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

        <SourceRegistration controller={controller} source={source} />

        {sourceNeedsApiKey && (
          <div className="space-y-1">
            <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
              Provider API key
              <Tooltip text="A manual collection URL in this source uses {api_key}. Save imagery, then set the key here - it is stored encrypted server-side and attached when tiles are proxied through the backend (never exposed to annotators)." />
            </label>
            <ApiKeyField
              campaignId={controller.campaignId}
              projectId={controller.projectId}
              persisted={controller.campaignId != null && isRealId(source.id)}
              hasApiKey={source.hasApiKey}
              organizationApiKeyId={source.organizationApiKeyId}
              onSave={async (body) => {
                if (controller.campaignId == null) return false;
                const { error } = await setSourceApiKey({
                  path: { campaign_id: controller.campaignId, source_id: Number(source.id) },
                  body,
                });
                return !error;
              }}
            />
          </div>
        )}

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
            <label className="text-xs text-neutral-700 flex items-center gap-1 shrink-0">
              Max native zoom
              <Tooltip text="Deepest zoom the provider serves real pixels for. Past it the map upscales instead of requesting tiles that cannot get sharper. Leave empty for no limit." />
            </label>
            <Input
              size="sm"
              type="number"
              min="1"
              max="22"
              value={source.maxNativeZoom ?? ''}
              onChange={(e) =>
                void updateSource({
                  maxNativeZoom: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="!w-14 text-center"
            />
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
              {hasStac && generationSeries.length === 0 && viz.name && (
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
            <div className="flex items-center gap-3">
              {generationSeries.map((series) => (
                <button
                  key={series.id}
                  type="button"
                  onClick={() => openGenerationEditor(series)}
                  className="text-xs font-medium text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
                >
                  Edit {series.config.collectionTitle} series
                </button>
              ))}
              {hasStac && generationSeries.length === 0 && (
                <button
                  type="button"
                  onClick={() => setBulkFocus({ kind: 'search' })}
                  className="text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
                >
                  Search settings · all collections
                </button>
              )}
            </div>
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
