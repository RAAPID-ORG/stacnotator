import React, { useState, useEffect, useCallback } from 'react';
import type { ImagerySourceOut, ImageryCollectionOut } from '~/api/client';
import { VizConfigPanel } from '~/features/campaigns/components/creation/steps/imagery/VizConfigPanel';
import type { VizParams } from '~/features/campaigns/components/creation/steps/imagery/types';
import { emptyVizParams } from '~/features/campaigns/components/creation/steps/imagery/types';
import { IconTrash, IconPlus, IconChevronDown, IconChevronUp } from '~/shared/ui/Icons';
import { fetchCollections } from '~/api/stacBrowser';
import type { AssetInfo } from '~/features/campaigns/components/creation/steps/imagery/collectionPresets';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

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
  if (vp.maskLayer) d.mask_layer = vp.maskLayer;
  if (vp.maskValues?.length) d.mask_values = vp.maskValues;
  if (vp.nirBand) d.nir_band = vp.nirBand;
  if (vp.redBand) d.red_band = vp.redBand;
  if (vp.maxItems !== undefined) d.max_items = Math.max(1, Math.min(10, vp.maxItems));
  return d;
}

// ── API ──

async function getToken() {
  const { authManager } = await import('~/features/auth/index');
  return authManager.getIdToken();
}

async function patchSource(campaignId: number, sourceId: number, body: Record<string, unknown>) {
  const token = await getToken();
  const resp = await fetch(`${API_BASE}/api/${campaignId}/imagery/sources/${sourceId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('Failed to update source');
  return resp.json();
}

async function putVizParams(
  campaignId: number,
  collectionId: number,
  body: {
    visualizations: Record<string, Record<string, unknown>>;
    cover_visualizations?: Record<string, Record<string, unknown>> | null;
  }
) {
  const token = await getToken();
  const resp = await fetch(
    `${API_BASE}/api/${campaignId}/imagery/collections/${collectionId}/viz-params`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) throw new Error('Failed to update viz params');
  return resp.json();
}

async function putTileUrls(
  campaignId: number,
  collectionId: number,
  body: { tile_urls: Record<string, string> }
) {
  const token = await getToken();
  const resp = await fetch(
    `${API_BASE}/api/${campaignId}/imagery/collections/${collectionId}/tile-urls`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) throw new Error('Failed to update tile URLs');
  return resp.json();
}

// ── Props ──

interface Props {
  imagery: ImagerySourceOut[];
  campaignId: number;
  setDeleteConfirm: (v: { imageryId?: number } | null) => void;
  onSourceUpdated: (
    sourceId: number,
    updates: { crosshair_hex6?: string; default_zoom?: number }
  ) => void;
  onCollectionVizUpdated?: () => void;
}

export const ImageryTab: React.FC<Props> = ({
  imagery,
  campaignId,
  setDeleteConfirm,
  onSourceUpdated,
  onCollectionVizUpdated,
}) => (
  <div id="tab-imagery" role="tabpanel" className="space-y-3">
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
  </div>
);

// ── Source card ──

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
  onUpdated: (id: number, u: { crosshair_hex6?: string; default_zoom?: number }) => void;
  onRefresh?: () => void;
}) {
  const [zoom, setZoom] = useState(source.default_zoom);
  const [color, setColor] = useState(source.crosshair_hex6);
  const [saving, setSaving] = useState(false);
  const [expandedCollectionId, setExpandedCollectionId] = useState<number | null>(null);
  const [vizNames, setVizNames] = useState(() => source.visualizations.map((v) => v.name));
  const [vizSaving, setVizSaving] = useState(false);

  const hasDisplayChanges = zoom !== source.default_zoom || color !== source.crosshair_hex6;
  const hasVizChanges =
    JSON.stringify(vizNames) !== JSON.stringify(source.visualizations.map((v) => v.name));

  const handleSaveDisplay = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (zoom !== source.default_zoom) updates.default_zoom = zoom;
      if (color !== source.crosshair_hex6) updates.crosshair_hex6 = color;
      await patchSource(campaignId, source.id, updates);
      onUpdated(source.id, updates as { crosshair_hex6?: string; default_zoom?: number });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveViz = async () => {
    setVizSaving(true);
    try {
      await patchSource(campaignId, source.id, {
        visualizations: vizNames.map((name) => ({ name })),
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

  return (
    <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-neutral-900">{source.name}</h4>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-red-500 hover:text-red-700 transition-colors cursor-pointer"
        >
          Remove
        </button>
      </div>

      {/* Display settings */}
      <div className="flex items-center gap-5 text-xs">
        <div className="flex items-center gap-1.5">
          <label className="text-neutral-500">Zoom:</label>
          <input
            type="number"
            min="1"
            max="22"
            value={zoom}
            onChange={(e) => setZoom(Math.max(1, Math.min(22, Number(e.target.value))))}
            className="w-12 border border-neutral-200 rounded px-1.5 py-0.5 text-xs text-center focus:border-brand-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-neutral-500">Crosshair:</label>
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
          <span className="text-neutral-400 font-mono">#{color}</span>
        </div>
        {hasDisplayChanges && (
          <button
            type="button"
            onClick={handleSaveDisplay}
            disabled={saving}
            className="ml-auto px-2.5 py-1 text-xs font-medium bg-brand-500 text-white rounded hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      {/* Visualizations */}
      <div>
        <span className="text-[11px] font-medium text-neutral-500">Visualizations</span>
        <div className="mt-1 space-y-1">
          {vizNames.map((name, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  const next = [...vizNames];
                  next[i] = e.target.value;
                  setVizNames(next);
                }}
                className="flex-1 text-xs border border-neutral-200 rounded px-2 py-1 focus:border-brand-500 outline-none"
                placeholder="Visualization name"
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
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => setVizNames((p) => [...p, ''])}
              className="text-[11px] text-brand-600 hover:text-brand-800 cursor-pointer flex items-center gap-0.5"
            >
              <IconPlus className="w-3 h-3" /> Add visualization
            </button>
            {hasVizChanges && (
              <button
                type="button"
                onClick={handleSaveViz}
                disabled={vizSaving}
                className="ml-auto px-2 py-0.5 text-[11px] font-medium bg-brand-500 text-white rounded hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {vizSaving ? 'Saving...' : 'Save Visualizations'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Collections */}
      {source.collections.length > 0 && (
        <div>
          <span className="text-[11px] font-medium text-neutral-500">
            Collections ({source.collections.length})
          </span>
          <div className="mt-1 space-y-1.5">
            {source.collections.map((col) => {
              const isExpanded = expandedCollectionId === col.id;
              const isStac = !!col.stac_config?.catalog_url;
              return (
                <div key={col.id} className="bg-neutral-50 rounded border border-neutral-100">
                  <button
                    type="button"
                    onClick={() => setExpandedCollectionId(isExpanded ? null : col.id)}
                    className="w-full text-left px-2.5 py-1.5 text-[11px] text-neutral-600 flex items-center justify-between cursor-pointer hover:bg-neutral-100"
                  >
                    <span>
                      <span className="font-medium">{col.name}</span>
                      <span className="ml-2 text-neutral-400">
                        {col.slices.length} slice{col.slices.length !== 1 ? 's' : ''}
                      </span>
                      <span className="ml-2 text-[10px] px-1 py-0.5 rounded bg-neutral-100 text-neutral-500">
                        {isStac ? 'STAC' : 'XYZ'}
                      </span>
                    </span>
                    <span className="text-[10px] text-brand-600">
                      {isExpanded ? 'Collapse' : 'Edit'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-neutral-100">
                      {isStac ? (
                        <StacVizEditor
                          collection={col}
                          vizNames={vizNames}
                          stacCollectionId={stacCollectionId}
                          catalogUrl={catalogUrl}
                          campaignId={campaignId}
                          onUpdated={onRefresh}
                        />
                      ) : (
                        <XyzUrlEditor
                          collection={col}
                          vizNames={vizNames}
                          campaignId={campaignId}
                          onUpdated={onRefresh}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
      for (const [name, params] of Object.entries(vizParamsMap)) vizBody[name] = toBackend(params);
      let coverBody: Record<string, Record<string, unknown>> | null = null;
      if (coverVizParamsMap) {
        coverBody = {};
        for (const [name, params] of Object.entries(coverVizParamsMap))
          coverBody[name] = toBackend(params);
      }
      await putVizParams(campaignId, collection.id, {
        visualizations: vizBody,
        cover_visualizations: coverBody,
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
    <div className="space-y-3 p-3">
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
              {vizNames.map((name, i) => (
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
                  {name || `Viz ${i + 1}`}
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
                  for (const [name, params] of Object.entries(vizParamsMap))
                    map[name] = { ...params, compositing: 'median' };
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
        </>
      )}
    </div>
  );
}

// ── XYZ collection URL editor (one URL input per visualization) ──

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
  // Get existing URLs from first slice
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
      await putTileUrls(campaignId, collection.id, { tile_urls: urls });
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
    <div className="p-3 space-y-2">
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

export default ImageryTab;
