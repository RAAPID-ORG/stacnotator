import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type {
  ImagerySourceOut,
  ImageryCollectionOut,
  ImageryViewOut,
  ViewCollectionRefItem,
} from '~/api/client';
import {
  updateSource as apiUpdateSource,
  updateCollection as apiUpdateCollection,
  updateVizParams as apiUpdateVizParams,
  updateTileUrls as apiUpdateTileUrls,
  refreshCollectionImagery as apiRefreshCollection,
  addView as apiAddView,
  updateView as apiUpdateView,
  deleteView as apiDeleteView,
} from '~/api/client';
import { useLayoutStore } from '~/features/layout/layout.store';
import { VizConfigPanel } from '~/features/campaigns/components/creation/steps/imagery/VizConfigPanel';
import type { VizParams } from '~/features/campaigns/components/creation/steps/imagery/types';
import { emptyVizParams } from '~/features/campaigns/components/creation/steps/imagery/types';
import { Tooltip } from '~/features/campaigns/components/creation/steps/imagery/Tooltip';
import {
  IconTrash,
  IconPlus,
  IconChevronDown,
  IconChevronUp,
  IconSettings,
  IconClock,
  IconEye,
  IconEyeSlash,
  IconLayers,
  IconDragHandle,
} from '~/shared/ui/Icons';
import { Modal } from '~/shared/ui/Modal';
import { fetchCollections } from '~/api/stacBrowser';
import type { AssetInfo } from '~/features/campaigns/components/creation/steps/imagery/collectionPresets';

// ── snake_case ↔ camelCase ──

function toFrontend(d: Record<string, unknown> | null | undefined): VizParams {
  const p = d ?? {};
  return {
    assets: (p.assets as string[]) ?? [],
    assetAsBand: (p.asset_as_band as boolean) ?? false,
    rescale: (p.rescale as string) ?? '',
    colormapName: (p.colormap_name as string) ?? undefined,
    colorFormula: (p.color_formula as string) ?? undefined,
    expression: (p.expression as string) ?? undefined,
    resampling: (p.resampling as string) ?? undefined,
    compositing: (p.compositing as string) ?? undefined,
    nodata: (p.nodata as number) ?? undefined,
    extraParams: (p.extra_params as Record<string, string>) ?? undefined,
    maskLayer: (p.mask_layer as string) ?? undefined,
    maskValues: (p.mask_values as number[]) ?? undefined,
    nirBand: (p.nir_band as string) ?? undefined,
    redBand: (p.red_band as string) ?? undefined,
    maxItems: (p.max_items as number) ?? undefined,
  };
}

function toBackend(vp: VizParams): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (vp.assets.length > 0) d.assets = vp.assets;
  if (vp.assetAsBand) d.asset_as_band = true;
  if (vp.rescale) d.rescale = vp.rescale;
  if (vp.colormapName) d.colormap_name = vp.colormapName;
  if (vp.colorFormula) d.color_formula = vp.colorFormula;
  if (vp.expression) d.expression = vp.expression;
  if (vp.resampling) d.resampling = vp.resampling;
  if (vp.compositing) d.compositing = vp.compositing;
  if (vp.nodata !== undefined) d.nodata = vp.nodata;
  if (vp.extraParams && Object.keys(vp.extraParams).length > 0) d.extra_params = vp.extraParams;
  if (vp.maskLayer) d.mask_layer = vp.maskLayer;
  if (vp.maskValues?.length) d.mask_values = vp.maskValues;
  if (vp.nirBand) d.nir_band = vp.nirBand;
  if (vp.redBand) d.red_band = vp.redBand;
  if (vp.maxItems !== undefined) d.max_items = Math.max(1, Math.min(10, vp.maxItems));
  return d;
}

// ── Props ──

interface Props {
  imagery: ImagerySourceOut[];
  views: ImageryViewOut[];
  campaignId: number;
  setDeleteConfirm: (v: { imageryId?: number } | null) => void;
  onSourceUpdated: (
    sourceId: number,
    updates: { name?: string; crosshair_hex6?: string; default_zoom?: number }
  ) => void;
  onCollectionVizUpdated?: () => void;
}

export const ImageryTab: React.FC<Props> = ({
  imagery,
  views,
  campaignId,
  setDeleteConfirm,
  onSourceUpdated,
  onCollectionVizUpdated,
}) => (
  <div id="tab-imagery" role="tabpanel" className="space-y-3">
    <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      <svg
        className="w-5 h-5 shrink-0 mt-0.5 text-amber-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
      <span>
        Editing imagery after campaign creation is not yet fully supported. Changes to sources or
        collections may require re-registration.
      </span>
    </div>
    {/* Sources */}
    <div className="bg-white rounded-lg border border-neutral-300 p-6">
      <h2 className="text-base font-semibold text-neutral-900 mb-4">
        Imagery Sources ({imagery.length})
      </h2>
      <div className="space-y-4">
        {imagery.length === 0 ? (
          <p className="text-xs text-neutral-500">No imagery sources added yet.</p>
        ) : (
          imagery.map((src) => (
            <SourceCard
              key={src.id}
              source={src}
              campaignId={campaignId}
              onDelete={() => setDeleteConfirm({ imageryId: src.id })}
              onUpdated={onSourceUpdated}
              onRefresh={onCollectionVizUpdated}
            />
          ))
        )}
      </div>
    </div>

    {/* Views */}
    <div className="bg-white rounded-lg border border-neutral-300 p-6">
      <h2 className="text-base font-semibold text-neutral-900 mb-4">View Layout</h2>
      <ViewsEditor
        views={views}
        sources={imagery}
        campaignId={campaignId}
        onChanged={onCollectionVizUpdated}
      />
    </div>
  </div>
);

// ── Source card (matches ImagerySourceEditor layout) ──

function SourceCard({
  source,
  campaignId,
  onDelete,
  onUpdated,
  onRefresh,
}: {
  source: ImagerySourceOut;
  campaignId: number;
  onDelete: () => void;
  onUpdated: (
    id: number,
    u: { name?: string; crosshair_hex6?: string; default_zoom?: number }
  ) => void;
  onRefresh?: () => void;
}) {
  const [name, setName] = useState(source.name);
  const [zoom, setZoom] = useState(source.default_zoom);
  const [color, setColor] = useState(source.crosshair_hex6);
  const [saving, setSaving] = useState(false);
  const [vizNames, setVizNames] = useState(() => source.visualizations.map((v) => v.name));
  const [vizSaving, setVizSaving] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null);

  const hasSourceChanges =
    name !== source.name || zoom !== source.default_zoom || color !== source.crosshair_hex6;
  const hasVizChanges =
    JSON.stringify(vizNames) !== JSON.stringify(source.visualizations.map((v) => v.name));

  const handleSaveSource = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (name !== source.name) body.name = name;
      if (zoom !== source.default_zoom) body.default_zoom = zoom;
      if (color !== source.crosshair_hex6) body.crosshair_hex6 = color;
      await apiUpdateSource({
        path: { campaign_id: campaignId, source_id: source.id },
        body: body as never,
      });
      onUpdated(
        source.id,
        body as { name?: string; crosshair_hex6?: string; default_zoom?: number }
      );
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveViz = async () => {
    setVizSaving(true);
    try {
      await apiUpdateSource({
        path: { campaign_id: campaignId, source_id: source.id },
        body: { visualizations: vizNames.map((n) => ({ name: n })) },
      });
      onRefresh?.();
    } catch (e) {
      console.error(e);
    } finally {
      setVizSaving(false);
    }
  };

  const stacCollectionId = source.collections[0]?.stac_config?.stac_collection_id ?? '';
  const catalogUrl = source.collections[0]?.stac_config?.catalog_url ?? '';
  const editingCollection = source.collections.find((c) => c.id === editingCollectionId) ?? null;

  return (
    <>
      <div className="rounded-lg border border-neutral-200 p-4 space-y-4">
        {/* Header: name + delete */}
        <div className="flex items-center justify-between">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm font-medium text-neutral-900 border-b border-transparent hover:border-neutral-300 focus:border-brand-500 outline-none px-0.5 py-0.5 -ml-0.5"
            placeholder="Source name"
          />
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-red-500 hover:text-red-700 transition-colors cursor-pointer"
          >
            Remove
          </button>
        </div>

        {/* Zoom + Crosshair row */}
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
              value={zoom}
              onChange={(e) => setZoom(Math.max(1, Math.min(22, Number(e.target.value))))}
              className="w-14 border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs text-center"
            />
            {zoom < 10 && (
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
                value={`#${color}`}
                onChange={(e) => setColor(e.target.value.replace('#', ''))}
                className="absolute opacity-0 w-5 h-5 cursor-pointer"
                id={`color-${source.id}`}
              />
              <label
                htmlFor={`color-${source.id}`}
                className="w-5 h-5 rounded-full border-2 border-neutral-300 cursor-pointer block"
                style={{ backgroundColor: `#${color}` }}
              />
            </div>
            <span className="text-neutral-400 font-mono text-xs">#{color}</span>
          </div>
          {hasSourceChanges && (
            <button
              type="button"
              onClick={handleSaveSource}
              disabled={saving}
              className="ml-auto px-2.5 py-1 text-xs font-medium bg-brand-500 text-white rounded hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>

        {/* Visualization Options */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
              Visualization Options
              <Tooltip text="Named visualizations (e.g. True Color, NDVI). Params are defined per-collection." />
            </label>
            <button
              type="button"
              onClick={() => setVizNames((p) => [...p, ''])}
              className="text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
            >
              + Add
            </button>
          </div>
          {vizNames.map((vizName, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="e.g. True Color"
                value={vizName}
                onChange={(e) => {
                  const next = [...vizNames];
                  next[i] = e.target.value;
                  setVizNames(next);
                }}
                className="flex-1 border-brand-500 border-b focus:border-b-2 outline-none focus:ring-0 text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  const n = [...vizNames];
                  [n[i - 1], n[i]] = [n[i], n[i - 1]];
                  setVizNames(n);
                }}
                disabled={i === 0}
                className="text-neutral-400 hover:text-neutral-600 disabled:opacity-30 cursor-pointer p-0.5"
                title="Move up"
              >
                <IconChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const n = [...vizNames];
                  [n[i], n[i + 1]] = [n[i + 1], n[i]];
                  setVizNames(n);
                }}
                disabled={i === vizNames.length - 1}
                className="text-neutral-400 hover:text-neutral-600 disabled:opacity-30 cursor-pointer p-0.5"
                title="Move down"
              >
                <IconChevronDown className="w-3 h-3" />
              </button>
              {vizNames.length > 1 && (
                <button
                  type="button"
                  onClick={() => setVizNames((p) => p.filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 cursor-pointer p-0.5"
                >
                  <IconTrash className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {hasVizChanges && (
            <div className="flex pt-1">
              <button
                type="button"
                onClick={handleSaveViz}
                disabled={vizSaving}
                className="ml-auto px-2.5 py-1 text-[11px] font-medium bg-brand-500 text-white rounded hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {vizSaving ? 'Saving...' : 'Save Visualizations'}
              </button>
            </div>
          )}
        </div>

        {/* Collection tiles */}
        {source.collections.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-neutral-700 flex items-center gap-1">
              Collections
              <Tooltip text="Click a collection to edit its visualization params, tile URLs, or metadata." />
            </h4>
            <div className="flex flex-wrap gap-2">
              {source.collections.map((col) => {
                const isStac = !!col.stac_config?.catalog_url;
                const isCover = col.cover_slice_index !== undefined;
                return (
                  <div
                    key={col.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditingCollectionId(col.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setEditingCollectionId(col.id);
                      }
                    }}
                    title="Click to configure"
                    className="group relative flex items-center justify-center rounded-lg border-2 transition-all cursor-pointer
                      px-3 py-2.5 shrink-0 border-neutral-200 bg-white text-neutral-800 hover:border-brand-400 hover:bg-brand-500/5"
                  >
                    <IconSettings className="w-3 h-3 mr-1.5 shrink-0 transition-opacity opacity-0 group-hover:opacity-100 text-brand-600" />
                    <span className="text-xs font-medium leading-tight truncate max-w-[120px]">
                      {col.name}
                    </span>
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded shrink-0 bg-neutral-100 text-neutral-500">
                      {isStac ? 'STAC' : 'XYZ'}
                    </span>
                    {col.slices.length > 1 && (
                      <span className="ml-1 text-[9px] shrink-0 flex items-center gap-0.5 text-neutral-400">
                        <IconClock className="w-2.5 h-2.5" />
                        {col.slices.length}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Collection editing modal */}
      {editingCollection && (
        <CollectionEditModal
          collection={editingCollection}
          vizNames={vizNames}
          stacCollectionId={stacCollectionId}
          catalogUrl={catalogUrl}
          campaignId={campaignId}
          onClose={() => setEditingCollectionId(null)}
          onUpdated={onRefresh}
        />
      )}
    </>
  );
}

// ── Collection editing modal ──

function CollectionEditModal({
  collection,
  vizNames,
  stacCollectionId,
  catalogUrl,
  campaignId,
  onClose,
  onUpdated,
}: {
  collection: ImageryCollectionOut;
  vizNames: string[];
  stacCollectionId: string;
  catalogUrl: string;
  campaignId: number;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const isStac = !!collection.stac_config?.catalog_url;

  const [colName, setColName] = useState(collection.name);
  const [coverIndex, setCoverIndex] = useState(collection.cover_slice_index ?? 0);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaSaved, setMetaSaved] = useState(false);

  const hasMetaChanges =
    colName !== collection.name || coverIndex !== (collection.cover_slice_index ?? 0);

  const handleSaveMeta = async () => {
    setMetaSaving(true);
    setMetaSaved(false);
    try {
      const body: Record<string, unknown> = {};
      if (colName !== collection.name) body.name = colName;
      if (coverIndex !== (collection.cover_slice_index ?? 0)) body.cover_slice_index = coverIndex;
      await apiUpdateCollection({
        path: { campaign_id: campaignId, collection_id: collection.id },
        body: body as never,
      });
      setMetaSaved(true);
      onUpdated?.();
      setTimeout(() => setMetaSaved(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setMetaSaving(false);
    }
  };

  return (
    <Modal title={`Edit Collection: ${collection.name}`} onClose={onClose}>
      <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
        {/* Collection metadata */}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-neutral-700 font-medium">Collection Name</label>
            <input
              type="text"
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              className="w-full border border-neutral-200 rounded px-2.5 py-1.5 text-xs focus:border-brand-500 outline-none"
            />
          </div>

          {collection.slices.length > 1 && (
            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
                Cover Slice
                <Tooltip text="The default-visible slice when this collection loads. Other slices are accessible via the dropdown." />
              </label>
              <select
                value={coverIndex}
                onChange={(e) => setCoverIndex(Number(e.target.value))}
                className="w-full border border-neutral-200 rounded px-2.5 py-1.5 text-xs focus:border-brand-500 outline-none"
              >
                {collection.slices.map((sl, i) => (
                  <option key={i} value={i}>
                    {sl.name || `Slice ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Slices (read-only) */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Slices ({collection.slices.length})
            </label>
            <div className="space-y-0.5">
              {collection.slices.map((sl, i) => (
                <div
                  key={i}
                  className={`text-[11px] px-2 py-1 rounded ${
                    i === coverIndex ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-500'
                  }`}
                >
                  {sl.name || `Slice ${i + 1}`}
                  {i === coverIndex && (
                    <span className="ml-1.5 text-[9px] bg-brand-100 text-brand-600 px-1 py-0.5 rounded">
                      cover
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {hasMetaChanges && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveMeta}
                disabled={metaSaving}
                className="px-2.5 py-1 text-[11px] font-medium bg-brand-500 text-white rounded hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {metaSaving ? 'Saving...' : 'Save'}
              </button>
              {metaSaved && <span className="text-[11px] text-green-600">Saved</span>}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-200" />

        {/* Viz params / tile URLs */}
        {isStac ? (
          <StacVizEditor
            collection={collection}
            vizNames={vizNames}
            stacCollectionId={stacCollectionId}
            catalogUrl={catalogUrl}
            campaignId={campaignId}
            onUpdated={onUpdated}
          />
        ) : (
          <XyzUrlEditor
            collection={collection}
            vizNames={vizNames}
            campaignId={campaignId}
            onUpdated={onUpdated}
          />
        )}
      </div>
    </Modal>
  );
}

// ── STAC collection viz editor (VizConfigPanel tabs) ──

function StacVizEditor({
  collection,
  vizNames,
  stacCollectionId,
  catalogUrl,
  campaignId,
  onUpdated,
}: {
  collection: ImageryCollectionOut;
  vizNames: string[];
  stacCollectionId: string;
  catalogUrl: string;
  campaignId: number;
  onUpdated?: () => void;
}) {
  const stac = collection.stac_config;

  const [availableAssets, setAvailableAssets] = useState<Record<string, AssetInfo>>({});
  const [loadingAssets, setLoadingAssets] = useState(true);

  useEffect(() => {
    if (!catalogUrl || !stac) {
      setLoadingAssets(false);
      return;
    }
    let cancelled = false;
    setLoadingAssets(true);
    fetchCollections(catalogUrl)
      .then((cols) => {
        if (cancelled) return;
        const match = cols.find((c) => c.id === stacCollectionId);
        if (match?.item_assets) {
          const assets: Record<string, AssetInfo> = {};
          for (const [k, v] of Object.entries(match.item_assets)) {
            assets[k] = { title: v.title, type: v.type, roles: v.roles };
          }
          setAvailableAssets(assets);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogUrl, stacCollectionId, stac]);

  const [vizParamsMap, setVizParamsMap] = useState<Record<string, VizParams>>(() => {
    const map: Record<string, VizParams> = {};
    const defaultParams = toFrontend(stac?.viz_params);
    for (const name of vizNames) map[name] = { ...defaultParams };
    const firstSlice = collection.slices[0];
    if (firstSlice) {
      for (const tu of firstSlice.tile_urls) {
        if (tu.visualization_name && vizNames.includes(tu.visualization_name)) {
          const parsed = parseTileUrlVizParams(tu.tile_url);
          if (parsed) map[tu.visualization_name] = parsed;
        }
      }
    }
    return map;
  });

  const [coverVizParamsMap, setCoverVizParamsMap] = useState<Record<string, VizParams> | null>(
    () => {
      if (!stac?.cover_viz_params) return null;
      const defaultParams = toFrontend(stac.cover_viz_params);
      const map: Record<string, VizParams> = {};
      for (const name of vizNames) map[name] = { ...defaultParams };
      return map;
    }
  );

  const [activeVizIndex, setActiveVizIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const activeVizName = vizNames[activeVizIndex] ?? vizNames[0] ?? '';

  const updateVizParams = useCallback(
    (params: VizParams) => {
      setVizParamsMap((prev) => ({ ...prev, [activeVizName]: params }));
    },
    [activeVizName]
  );

  const updateCoverVizParams = useCallback(
    (params: VizParams) => {
      setCoverVizParamsMap((prev) => (prev ? { ...prev, [activeVizName]: params } : prev));
    },
    [activeVizName]
  );

  if (!stac) return null;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const vizBody: Record<string, Record<string, unknown>> = {};
      for (const [n, params] of Object.entries(vizParamsMap)) vizBody[n] = toBackend(params);
      let coverBody: Record<string, Record<string, unknown>> | null = null;
      if (coverVizParamsMap) {
        coverBody = {};
        for (const [n, params] of Object.entries(coverVizParamsMap))
          coverBody[n] = toBackend(params);
      }
      await apiUpdateVizParams({
        path: { campaign_id: campaignId, collection_id: collection.id },
        body: { visualizations: vizBody, cover_visualizations: coverBody } as never,
      });
      setSaved(true);
      onUpdated?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const hasCover = coverVizParamsMap !== null;

  return (
    <div className="space-y-3">
      {loadingAssets ? (
        <div className="flex items-center justify-center py-8 gap-2">
          <svg className="animate-spin h-4 w-4 text-brand-500" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-xs text-neutral-500">Loading asset metadata from catalog...</span>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="rounded-lg border border-neutral-200 overflow-hidden">
            <div className="flex items-center bg-neutral-50 border-b border-neutral-200 px-2 pt-2 gap-1">
              {vizNames.map((n, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveVizIndex(i)}
                  className={`text-xs px-3 py-1.5 rounded-t-md transition-colors cursor-pointer ${
                    i === activeVizIndex
                      ? 'bg-white border border-neutral-200 border-b-white -mb-px text-brand-700 font-medium'
                      : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  {n || `Viz ${i + 1}`}
                </button>
              ))}
            </div>
            <div className="p-3 bg-white">
              <VizConfigPanel
                collectionId={stacCollectionId}
                availableAssets={availableAssets}
                vizParams={vizParamsMap[activeVizName] ?? emptyVizParams()}
                onChange={updateVizParams}
                showCompositing
              />
            </div>
          </div>

          {/* Cover override */}
          {hasCover && (
            <div className="rounded-lg border border-neutral-200 overflow-hidden">
              <div className="flex items-center justify-between bg-neutral-50 border-b border-neutral-200 px-3 py-2">
                <span className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider">
                  Cover Slice Override - {activeVizName}
                </span>
                <button
                  type="button"
                  onClick={() => setCoverVizParamsMap(null)}
                  className="text-[10px] text-red-500 hover:text-red-700 cursor-pointer"
                >
                  Remove
                </button>
              </div>
              <div className="p-3 bg-white">
                <VizConfigPanel
                  collectionId={stacCollectionId}
                  availableAssets={availableAssets}
                  vizParams={coverVizParamsMap?.[activeVizName] ?? emptyVizParams()}
                  onChange={updateCoverVizParams}
                  showCompositing
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {!hasCover && (
              <button
                type="button"
                onClick={() => {
                  const map: Record<string, VizParams> = {};
                  for (const [n, params] of Object.entries(vizParamsMap))
                    map[n] = { ...params, compositing: 'median' };
                  setCoverVizParamsMap(map);
                }}
                className="text-[10px] text-brand-600 hover:text-brand-800 cursor-pointer"
              >
                + Add cover slice override
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="ml-auto px-2.5 py-1 text-[11px] font-medium bg-brand-500 text-white rounded hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Viz Params'}
            </button>
            {saved && <span className="text-[11px] text-green-600">Saved & tile URLs rebuilt</span>}
          </div>

          {/* Re-register mosaics */}
          <RefreshMosaicButton
            collectionId={collection.id}
            campaignId={campaignId}
            onRefreshed={onUpdated}
          />
        </>
      )}
    </div>
  );
}

// ── XYZ collection URL editor ──

function XyzUrlEditor({
  collection,
  vizNames,
  campaignId,
  onUpdated,
}: {
  collection: ImageryCollectionOut;
  vizNames: string[];
  campaignId: number;
  onUpdated?: () => void;
}) {
  const firstSlice = collection.slices[0];
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const name of vizNames) map[name] = '';
    if (firstSlice) {
      for (const tu of firstSlice.tile_urls) {
        if (tu.visualization_name) map[tu.visualization_name] = tu.tile_url;
      }
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await apiUpdateTileUrls({
        path: { campaign_id: campaignId, collection_id: collection.id },
        body: { tile_urls: urls } as never,
      });
      setSaved(true);
      onUpdated?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
        Tile URLs
      </span>
      {vizNames.map((name) => (
        <div key={name} className="space-y-0.5">
          <label className="text-[11px] text-neutral-500">{name || 'Default'}</label>
          <input
            type="text"
            value={urls[name] ?? ''}
            onChange={(e) => setUrls((prev) => ({ ...prev, [name]: e.target.value }))}
            placeholder="https://.../{z}/{x}/{y}.png"
            className="w-full text-[11px] font-mono border border-neutral-200 rounded px-2 py-1.5 focus:border-brand-500 outline-none"
          />
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="ml-auto px-2.5 py-1 text-[11px] font-medium bg-brand-500 text-white rounded hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save URLs'}
        </button>
        {saved && <span className="text-[11px] text-green-600">Saved</span>}
      </div>
    </div>
  );
}

// ── Helpers ──

function parseTileUrlVizParams(tileUrl: string): VizParams | null {
  try {
    const url = new URL(tileUrl, 'https://placeholder');
    const params = url.searchParams;
    const assets = params.getAll('assets');
    if (assets.length === 0) return null;
    return {
      assets,
      assetAsBand: params.get('asset_as_band') === 'true',
      rescale: params.getAll('rescale')[0] ?? '',
      colormapName: params.get('colormap_name') ?? undefined,
      colorFormula: params.get('color_formula') ?? undefined,
      expression: params.get('expression') ?? undefined,
      resampling: params.get('resampling') ?? undefined,
      compositing: params.get('compositing') ?? undefined,
      nodata: params.has('nodata') ? Number(params.get('nodata')) : undefined,
      maskLayer: params.get('mask_layer') ?? undefined,
      maskValues:
        params
          .getAll('mask_values')
          .map(Number)
          .filter((n) => !isNaN(n)) || undefined,
      maxItems: params.has('max_items') ? Number(params.get('max_items')) : undefined,
    };
  } catch {
    return null;
  }
}

// ── Refresh mosaic button ──

function RefreshMosaicButton({
  collectionId,
  campaignId,
  onRefreshed,
}: {
  collectionId: number;
  campaignId: number;
  onRefreshed?: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleRefresh = async () => {
    if (
      !confirm(
        'Re-register mosaics for this collection?\n\n' +
          'This will re-search the STAC catalog with the current query and bbox, ' +
          'updating mosaic items and tile URLs.\n\n' +
          'Note: Existing mosaic search IDs will be replaced. ' +
          'The STAC data is fetched at registration time and frozen - ' +
          'if the catalog adds new items later, you need to refresh again.'
      )
    )
      return;

    setRefreshing(true);
    setResult(null);
    try {
      const { error } = await apiRefreshCollection({
        path: { campaign_id: campaignId, collection_id: collectionId },
      });
      if (error) throw new Error('Refresh failed');
      setResult({ ok: true, message: 'Mosaics re-registered' });
      onRefreshed?.();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Refresh failed' });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="border-t border-neutral-100 pt-2 mt-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-2.5 py-1 text-[11px] font-medium border border-neutral-300 text-neutral-700 rounded hover:bg-neutral-50 transition-colors cursor-pointer disabled:opacity-50"
        >
          {refreshing ? 'Re-registering...' : 'Re-register Mosaics'}
        </button>
        {result && (
          <span className={`text-[11px] ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
            {result.message}
          </span>
        )}
      </div>
      <p className="text-[10px] text-neutral-400 mt-1 leading-snug">
        Re-searches the STAC catalog with current params and rebuilds tile URLs. STAC data is frozen
        at registration time - refresh to pick up new catalog items.
      </p>
    </div>
  );
}

// ── Views editor (matches CanvasPreview layout from creation) ──

function ViewsEditor({
  views,
  sources,
  campaignId,
  onChanged,
}: {
  views: ImageryViewOut[];
  sources: ImagerySourceOut[];
  campaignId: number;
  onChanged?: () => void;
}) {
  const [activeViewId, setActiveViewId] = useState<number | null>(views[0]?.id ?? null);
  const [editingViewName, setEditingViewName] = useState<number | null>(null);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const addSourceBtnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (addSourceOpen && addSourceBtnRef.current) {
      const rect = addSourceBtnRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 160) });
    }
  }, [addSourceOpen]);

  // Keep activeViewId valid
  useEffect(() => {
    if (!views.find((v) => v.id === activeViewId) && views.length > 0) {
      setActiveViewId(views[0].id);
    }
  }, [views, activeViewId]);

  const activeView = views.find((v) => v.id === activeViewId) ?? views[0] ?? null;
  const allRefs = activeView?.collection_refs ?? [];

  // Resolve refs to source/collection objects
  type ResolvedRef = {
    ref: ViewCollectionRefItem;
    source: ImagerySourceOut;
    collection: ImageryCollectionOut;
  };

  const allResolved: ResolvedRef[] = allRefs
    .map((ref) => {
      const source = sources.find((s) => s.id === ref.source_id);
      const collection = source?.collections.find((c) => c.id === ref.collection_id);
      if (!source || !collection) return null;
      return { ref, source, collection };
    })
    .filter(Boolean) as ResolvedRef[];

  const visibleWindows = allResolved.filter((r) => r.ref.show_as_window);
  const hiddenWindows = allResolved.filter((r) => !r.ref.show_as_window);

  // Sources assigned to this view
  const assignedSourceIds = new Set(allRefs.map((r) => r.source_id));
  const orderedSourceIds: number[] = [];
  for (const ref of allRefs) {
    if (!orderedSourceIds.includes(ref.source_id)) orderedSourceIds.push(ref.source_id);
  }
  const assignedSources = orderedSourceIds
    .map((id) => sources.find((s) => s.id === id))
    .filter(Boolean) as ImagerySourceOut[];
  const unassignedSources = sources.filter((s) => !assignedSourceIds.has(s.id));

  // Drag reorder sources
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const saveRefs = async (viewId: number, newRefs: ViewCollectionRefItem[]) => {
    setSaving(true);
    try {
      await apiUpdateView({
        path: { campaign_id: campaignId, view_id: viewId },
        body: { collection_refs: newRefs },
      });
      onChanged?.();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const toggleCollectionVisibility = (collectionId: number, sourceId: number) => {
    if (!activeView) return;
    const newRefs = activeView.collection_refs.map((r) =>
      r.collection_id === collectionId && r.source_id === sourceId
        ? { ...r, show_as_window: !r.show_as_window }
        : r
    );
    saveRefs(activeView.id, newRefs);
  };

  const toggleSourceInView = (sourceId: number) => {
    if (!activeView) return;
    const isAssigned = activeView.collection_refs.some((r) => r.source_id === sourceId);
    if (isAssigned) {
      // Remove all collections from this source
      const newRefs = activeView.collection_refs.filter((r) => r.source_id !== sourceId);
      saveRefs(activeView.id, newRefs);
    } else {
      // Add all collections from this source
      const source = sources.find((s) => s.id === sourceId);
      if (!source) return;
      const newRefs: ViewCollectionRefItem[] = [
        ...activeView.collection_refs,
        ...source.collections.map((c) => ({
          collection_id: c.id,
          source_id: sourceId,
          show_as_window: true,
        })),
      ];
      saveRefs(activeView.id, newRefs);
    }
  };

  const reorderSource = (fromIdx: number, toIdx: number) => {
    if (!activeView || fromIdx === toIdx) return;
    const ordered = [...orderedSourceIds];
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    const reordered = ordered.flatMap((sid) =>
      activeView.collection_refs.filter((r) => r.source_id === sid)
    );
    saveRefs(activeView.id, reordered);
  };

  const handleAddView = async () => {
    try {
      const { data } = await apiAddView({
        path: { campaign_id: campaignId },
        body: { name: `View ${views.length + 1}` },
      });
      onChanged?.();
      if (data && typeof data === 'object' && 'id' in data) {
        setActiveViewId((data as { id: number }).id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteView = async (viewId: number) => {
    try {
      await apiDeleteView({ path: { campaign_id: campaignId, view_id: viewId } });
      onChanged?.();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRenameView = async (viewId: number, newName: string) => {
    try {
      await apiUpdateView({
        path: { campaign_id: campaignId, view_id: viewId },
        body: { name: newName },
      });
      onChanged?.();
    } catch (e) {
      console.error(e);
    }
  };

  const sortedViews = [...views].sort((a, b) => a.display_order - b.display_order);

  const handleMoveView = async (viewId: number, direction: -1 | 1) => {
    const idx = sortedViews.findIndex((v) => v.id === viewId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= sortedViews.length) return;
    const viewA = sortedViews[idx];
    const viewB = sortedViews[newIdx];
    try {
      await Promise.all([
        apiUpdateView({
          path: { campaign_id: campaignId, view_id: viewA.id },
          body: { display_order: newIdx },
        }),
        apiUpdateView({
          path: { campaign_id: campaignId, view_id: viewB.id },
          body: { display_order: idx },
        }),
      ]);
      onChanged?.();
      showAlert('View order updated', 'success');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="rounded-lg bg-neutral-100 border border-neutral-200 overflow-hidden">
      {/* View tabs header */}
      <div className="bg-neutral-700 px-3 py-1.5 flex items-center gap-1.5">
        {sortedViews.map((v, viewIdx) => {
          const isActive = activeView?.id === v.id;
          const isEditing = editingViewName === v.id;
          return (
            <div
              key={v.id}
              className={`group flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-brand-500 text-white'
                  : 'text-neutral-300 border border-neutral-500 hover:bg-neutral-600'
              }`}
              onClick={() => {
                if (isActive && !isEditing) {
                  setEditingViewName(v.id);
                } else {
                  setActiveViewId(v.id);
                }
              }}
            >
              {/* Move left */}
              {sortedViews.length > 1 && viewIdx > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveView(v.id, -1);
                  }}
                  className={`rounded p-0.5 -ml-1 transition-colors ${
                    isActive
                      ? 'text-white/60 hover:text-white hover:bg-white/15'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-500/50'
                  }`}
                  title="Move left"
                >
                  <IconChevronUp className="w-3.5 h-3.5 -rotate-90" />
                </button>
              )}
              {isEditing ? (
                <input
                  type="text"
                  defaultValue={v.name}
                  onBlur={(e) => {
                    setEditingViewName(null);
                    if (e.target.value !== v.name) handleRenameView(v.id, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setEditingViewName(null);
                      if ((e.target as HTMLInputElement).value !== v.name)
                        handleRenameView(v.id, (e.target as HTMLInputElement).value);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="bg-transparent border-0 border-b border-white/40 text-xs text-white outline-none w-20 py-0 px-0"
                />
              ) : (
                <span
                  className="flex items-center gap-1"
                  title={isActive ? 'Click to rename' : 'Click to switch view'}
                >
                  {v.name || 'Untitled View'}
                  {isActive && (
                    <svg
                      className="w-2.5 h-2.5 text-white/50"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
                    </svg>
                  )}
                </span>
              )}
              {/* Move right */}
              {sortedViews.length > 1 && viewIdx < sortedViews.length - 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveView(v.id, 1);
                  }}
                  className={`rounded p-0.5 transition-colors ${
                    isActive
                      ? 'text-white/60 hover:text-white hover:bg-white/15'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-500/50'
                  }`}
                  title="Move right"
                >
                  <IconChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </button>
              )}
              {/* Divider before delete */}
              {isActive && views.length > 1 && (
                <>
                  <span className="w-px h-3.5 bg-white/20 mx-0.5" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteView(v.id);
                    }}
                    className="text-white/50 hover:text-white hover:bg-white/15 rounded p-0.5 transition-colors"
                    title="Remove view"
                  >
                    <IconTrash className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={handleAddView}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-dashed border-neutral-500 text-neutral-400 hover:text-neutral-200 hover:border-neutral-400 transition-colors cursor-pointer text-xs"
          title="Add a new view"
        >
          <IconPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* View body */}
      <div className="p-3">
        <div className="flex gap-1.5" style={{ minHeight: 200 }}>
          {/* Sources sidebar */}
          <div className="w-[140px] shrink-0 bg-white rounded border border-neutral-200 overflow-hidden flex flex-col">
            <div className="px-2 py-1 border-b border-neutral-100">
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                Sources
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
              {assignedSources.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-1.5 py-4 px-2">
                  <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
                    <IconPlus className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                  <span className="text-[10px] text-amber-600 text-center leading-tight font-medium">
                    Add sources to this view
                  </span>
                </div>
              )}

              {assignedSources.map((source, idx) => (
                <div
                  key={source.id}
                  draggable
                  onDragStart={() => {
                    dragIdx.current = idx;
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIdx(idx);
                  }}
                  onDrop={() => {
                    if (dragIdx.current !== null) reorderSource(dragIdx.current, idx);
                    dragIdx.current = null;
                    setDragOverIdx(null);
                  }}
                  onDragEnd={() => {
                    dragIdx.current = null;
                    setDragOverIdx(null);
                  }}
                  className={`group flex items-center gap-0.5 rounded transition-colors cursor-grab active:cursor-grabbing text-neutral-600 hover:bg-neutral-100 ${dragOverIdx === idx ? 'ring-1 ring-brand-400 ring-offset-1' : ''}`}
                >
                  <span className="shrink-0 px-0.5 text-neutral-300">
                    <IconDragHandle className="w-2.5 h-2.5" />
                  </span>
                  <span className="flex-1 min-w-0 px-1 py-1 text-[11px] leading-tight flex items-center gap-1">
                    <IconLayers className="w-3 h-3 shrink-0 text-neutral-400" />
                    <span className="break-words whitespace-normal leading-snug">
                      {source.name || 'Untitled'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSourceInView(source.id);
                    }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-neutral-300 hover:text-red-500"
                    title="Remove from view"
                  >
                    <IconTrash className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}

              {/* Add source dropdown */}
              <div className="mt-0.5">
                <button
                  ref={addSourceBtnRef}
                  type="button"
                  onClick={() => setAddSourceOpen((v) => !v)}
                  className="w-full flex items-center justify-center gap-1 px-1.5 py-1.5 text-[11px] text-neutral-500 rounded border border-dashed border-neutral-200 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50/40 transition-colors cursor-pointer"
                >
                  <IconPlus className="w-3 h-3" />
                  <span>Add source</span>
                </button>
                {addSourceOpen &&
                  dropdownPos &&
                  createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[9998]"
                        onClick={() => setAddSourceOpen(false)}
                      />
                      <div
                        className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-neutral-200 overflow-hidden"
                        style={{
                          top: dropdownPos.top,
                          left: dropdownPos.left,
                          width: dropdownPos.width,
                        }}
                      >
                        {unassignedSources.length > 0 ? (
                          <div className="py-1">
                            <div className="px-2.5 py-1 text-[9px] font-semibold text-neutral-400 uppercase tracking-wider">
                              Available
                            </div>
                            {unassignedSources.map((src) => (
                              <button
                                key={src.id}
                                type="button"
                                onClick={() => {
                                  toggleSourceInView(src.id);
                                  setAddSourceOpen(false);
                                }}
                                className="w-full text-left px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 text-neutral-700 hover:bg-brand-50 hover:text-brand-700 cursor-pointer transition-colors"
                              >
                                <IconLayers className="w-3 h-3 shrink-0 text-neutral-400" />
                                <span className="truncate">{src.name || 'Untitled'}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-2.5 py-2.5 text-[11px] text-neutral-400 text-center">
                            All sources already added
                          </div>
                        )}
                      </div>
                    </>,
                    document.body
                  )}
              </div>
            </div>
          </div>

          {/* Windows grid */}
          <div className="flex-1 flex flex-col gap-1.5 min-w-0">
            {visibleWindows.length > 0 ? (
              <div className="grid grid-cols-4 gap-1.5">
                {visibleWindows.map((win, i) => (
                  <div
                    key={`${win.collection.id}-${i}`}
                    className="rounded border border-neutral-200 bg-white overflow-hidden flex flex-col"
                  >
                    <div className="bg-neutral-50 px-2 py-1 border-b border-neutral-100 flex items-center justify-between gap-1 min-h-[22px]">
                      <span
                        className="text-[11px] font-semibold text-neutral-700 truncate leading-none"
                        title={`${win.collection.name} (${win.source.name})`}
                      >
                        {win.collection.name}{' '}
                        <span className="font-normal text-neutral-400">({win.source.name})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleCollectionVisibility(win.collection.id, win.source.id)}
                        className="text-neutral-300 hover:text-neutral-500 transition-colors cursor-pointer shrink-0"
                        title="Hide from view"
                      >
                        <IconEyeSlash className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="relative" style={{ minHeight: 48 }}>
                      <div
                        className="absolute inset-0 opacity-[0.03]"
                        style={{
                          backgroundImage:
                            'linear-gradient(to right, #666 1px, transparent 1px), linear-gradient(to bottom, #666 1px, transparent 1px)',
                          backgroundSize: '16px 16px',
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <line
                            x1="0"
                            y1="8"
                            x2="6"
                            y2="8"
                            stroke={`#${win.source.crosshair_hex6}`}
                            strokeWidth="0.8"
                            opacity="0.5"
                          />
                          <line
                            x1="10"
                            y1="8"
                            x2="16"
                            y2="8"
                            stroke={`#${win.source.crosshair_hex6}`}
                            strokeWidth="0.8"
                            opacity="0.5"
                          />
                          <line
                            x1="8"
                            y1="0"
                            x2="8"
                            y2="6"
                            stroke={`#${win.source.crosshair_hex6}`}
                            strokeWidth="0.8"
                            opacity="0.5"
                          />
                          <line
                            x1="8"
                            y1="10"
                            x2="8"
                            y2="16"
                            stroke={`#${win.source.crosshair_hex6}`}
                            strokeWidth="0.8"
                            opacity="0.5"
                          />
                        </svg>
                      </div>
                      {win.collection.slices.length > 1 && (
                        <div className="absolute bottom-1 right-1 text-[9px] text-neutral-400 bg-white/80 rounded px-1 py-0.5">
                          {win.collection.slices.length} slices
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center rounded border border-dashed border-neutral-200 bg-neutral-50/50">
                <span className="text-xs text-neutral-400">
                  {assignedSources.length === 0
                    ? 'Add sources to this view to see windows'
                    : 'No visible windows - show some from the hidden list below'}
                </span>
              </div>
            )}

            {/* Warning for many windows */}
            {visibleWindows.length > 12 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800 text-[11px]">
                <strong>{visibleWindows.length}</strong> visible windows may slow performance.
                Consider hiding some or splitting across views.
              </div>
            )}

            {/* Hidden windows */}
            {hiddenWindows.length > 0 && (
              <div className="rounded border border-dashed border-neutral-200 bg-neutral-50/50 px-2 py-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-neutral-400 font-medium uppercase tracking-wider shrink-0">
                    <IconEyeSlash className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                    Hidden
                  </span>
                  {hiddenWindows.map((hw) => (
                    <button
                      key={hw.collection.id}
                      type="button"
                      onClick={() => toggleCollectionVisibility(hw.collection.id, hw.source.id)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-neutral-500 bg-white border border-neutral-200 hover:border-brand-400 hover:text-brand-700 hover:bg-brand-50/30 transition-colors cursor-pointer"
                      title={`Show "${hw.collection.name}" as a window`}
                    >
                      <IconEye className="w-2.5 h-2.5" />
                      <span className="truncate max-w-[100px]">{hw.collection.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Warning: sources not in any view */}
        {(() => {
          const allViewSourceIds = new Set(
            views.flatMap((v) => v.collection_refs.map((r) => r.source_id))
          );
          const notInAny = sources.filter((s) => !allViewSourceIds.has(s.id));
          if (notInAny.length === 0) return null;
          return (
            <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded border border-red-200 bg-red-50/60">
              <div className="text-[11px] text-red-700 leading-relaxed">
                <span className="font-semibold">
                  {notInAny.length === 1 ? '1 source' : `${notInAny.length} sources`} not in any
                  view:
                </span>{' '}
                {notInAny.map((s) => s.name || 'Untitled').join(', ')}
                <span className="text-red-500">
                  {' '}
                  - add {notInAny.length === 1 ? 'it' : 'them'} to a view or{' '}
                  {notInAny.length === 1 ? 'it' : 'they'} won't appear for annotators.
                </span>
              </div>
            </div>
          );
        })()}
      </div>

      {saving && (
        <div className="px-3 pb-2">
          <span className="text-[10px] text-neutral-400">Saving...</span>
        </div>
      )}
    </div>
  );
}

export default ImageryTab;
