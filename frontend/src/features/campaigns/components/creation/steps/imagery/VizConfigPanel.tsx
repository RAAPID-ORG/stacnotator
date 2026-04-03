import { useState, useEffect } from 'react';
import {
  COLLECTION_PRESETS,
  KNOWN_RESCALE,
  COLORMAPS,
  getRasterAssets,
  isPreRenderedRGB,
  guessRescale,
} from './collectionPresets';
import type { BandPreset, AssetInfo } from './collectionPresets';
import type { VizParams } from './types';
import { IconChevronDown, IconChevronUp } from '~/shared/ui/Icons';

interface VizConfigPanelProps {
  collectionId: string;
  availableAssets: Record<string, AssetInfo>;
  vizParams: VizParams;
  onChange: (params: VizParams) => void;
  showCompositing?: boolean;
}

export const VizConfigPanel = ({
  collectionId,
  availableAssets,
  vizParams,
  onChange,
  showCompositing = false,
}: VizConfigPanelProps) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isRgbAsset, setIsRgbAsset] = useState(false);

  const rasterAssets = getRasterAssets(availableAssets);
  const presets = COLLECTION_PRESETS[collectionId] || [];
  const validPresets = presets.filter((p) =>
    p.assets.every((a) => rasterAssets.some(([k]) => k === a))
  );
  const knownRescale = KNOWN_RESCALE[collectionId];
  const defaultRescale = knownRescale || guessRescale(collectionId);

  // Auto-fill rescale on first render if known
  useEffect(() => {
    if (!vizParams.rescale && defaultRescale) {
      onChange({ ...vizParams, rescale: defaultRescale });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = <K extends keyof VizParams>(key: K, value: VizParams[K]) => {
    onChange({ ...vizParams, [key]: value });
  };

  const toggleBand = (band: string) => {
    const prev = vizParams.assets;
    let next: string[];
    if (prev.includes(band)) {
      next = prev.filter((b) => b !== band);
    } else if (prev.length < 3) {
      next = [...prev, band];
    } else {
      next = prev;
    }
    onChange({
      ...vizParams,
      assets: next,
      assetAsBand: next.length === 3,
    });
  };

  const applyPreset = (preset: BandPreset) => {
    const updates: Partial<VizParams> = {
      assets: preset.assets,
      assetAsBand: preset.assets.length === 3,
    };
    if (preset.colormap) updates.colormapName = preset.colormap;
    if (preset.rescale) {
      updates.rescale = preset.rescale;
    } else if (knownRescale) {
      updates.rescale = knownRescale;
    }
    if (preset.expression) updates.expression = preset.expression;
    if (preset.extraParams) updates.extraParams = { ...preset.extraParams };

    if (
      preset.assets.length === 1 &&
      isPreRenderedRGB(preset.assets[0], availableAssets[preset.assets[0]]?.roles)
    ) {
      setIsRgbAsset(true);
    } else {
      setIsRgbAsset(false);
    }

    onChange({ ...vizParams, ...updates });
  };

  const bandLabel = (i: number) => {
    if (vizParams.assets.length === 1) return 'S';
    return ['R', 'G', 'B'][i] || '';
  };

  const bandColorClass = (i: number) => {
    if (vizParams.assets.length === 1) return 'bg-purple-100 border-purple-400 text-purple-800';
    return (
      [
        'bg-red-100 border-red-400 text-red-800',
        'bg-green-100 border-green-400 text-green-800',
        'bg-blue-100 border-blue-400 text-blue-800',
      ][i] || ''
    );
  };

  const showColormap = vizParams.assets.length === 1 && !isRgbAsset && !vizParams.expression;

  return (
    <div className="space-y-4">
      {/* Quick presets */}
      {validPresets.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs text-neutral-700 font-medium">Quick Presets</label>
          <div className="flex flex-wrap gap-1.5">
            {validPresets.map((p, i) => {
              const isActive =
                p.assets.length === vizParams.assets.length &&
                p.assets.every((a, j) => a === vizParams.assets[j]);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                    isActive
                      ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                      : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Band picker */}
      <div className="space-y-1.5">
        <label className="text-xs text-neutral-700 font-medium">
          Bands{' '}
          <span className="font-normal text-neutral-500">Select 1 (colorized) or 3 (RGB)</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {rasterAssets.map(([key, info]) => {
            const idx = vizParams.assets.indexOf(key);
            const selected = idx >= 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleBand(key)}
                title={info.title || key}
                className={`relative text-xs px-2 py-1 rounded border transition-colors cursor-pointer ${
                  selected
                    ? bandColorClass(idx)
                    : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                }`}
              >
                {selected && (
                  <span className="absolute -top-1.5 -left-1 text-[9px] font-bold leading-none">
                    {bandLabel(idx)}
                  </span>
                )}
                {info.title || key}
              </button>
            );
          })}
        </div>
        {/* Selection summary */}
        <div className="text-[11px] text-neutral-500">
          {vizParams.assets.length === 0 && 'No bands selected'}
          {vizParams.assets.length === 1 &&
            (isRgbAsset
              ? `Pre-rendered RGB: ${vizParams.assets[0]}`
              : `Single band: ${vizParams.assets[0]} (colorized)`)}
          {vizParams.assets.length === 2 && 'Select a 3rd band for RGB, or remove one'}
          {vizParams.assets.length === 3 && (
            <>
              RGB: <span className="text-red-600">{vizParams.assets[0]}</span> /{' '}
              <span className="text-green-600">{vizParams.assets[1]}</span> /{' '}
              <span className="text-blue-600">{vizParams.assets[2]}</span>
            </>
          )}
        </div>
      </div>

      {/* Colormap */}
      {showColormap && (
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Colormap</label>
          <select
            value={vizParams.colormapName || 'viridis'}
            onChange={(e) => update('colormapName', e.target.value)}
            className="w-full border border-neutral-300 rounded-md px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          >
            {COLORMAPS.map((cm) => (
              <option key={cm.value} value={cm.value}>
                {cm.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Rescale */}
      <div className="space-y-1">
        <label className="text-xs text-neutral-700 font-medium">Rescale (min,max)</label>
        <input
          type="text"
          value={vizParams.rescale || ''}
          onChange={(e) => update('rescale', e.target.value)}
          placeholder={defaultRescale || 'e.g. 0,3000'}
          className="w-full border border-neutral-300 rounded-md px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        />
        <p className="text-[11px] text-neutral-400">
          Applied to each band. Leave empty to auto-detect from data statistics.
        </p>
      </div>

      {/* Compositing (mosaic mode only) */}
      {showCompositing && (
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Compositing Method</label>
          <select
            value={vizParams.compositing || 'first'}
            onChange={(e) => update('compositing', e.target.value)}
            className="w-full border border-neutral-300 rounded-md px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          >
            <option value="first">First valid pixel</option>
            <option value="mean">Mean</option>
            <option value="median">Median</option>
            <option value="max">Maximum</option>
            <option value="min">Minimum</option>
            {collectionId.includes('sentinel-2') && (
              <option value="ndvi_best">Best NDVI pixel</option>
            )}
          </select>
          {vizParams.compositing && vizParams.compositing !== 'first' && (
            <p className="text-[10px] text-amber-600 mt-1">
              Mean, median, max, min, and NDVI best compositing are experimental and slower than
              first valid pixel - each tile reads multiple scenes.
            </p>
          )}
        </div>
      )}

      {/* Advanced */}
      <div className="rounded-md border border-neutral-200">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-neutral-50 transition-colors"
        >
          <span className="text-xs text-neutral-700 font-medium">Advanced Options</span>
          {showAdvanced ? (
            <IconChevronUp className="w-3.5 h-3.5 text-neutral-400" />
          ) : (
            <IconChevronDown className="w-3.5 h-3.5 text-neutral-400" />
          )}
        </button>

        {showAdvanced && (
          <div className="px-3 pb-3 space-y-3 border-t border-neutral-100">
            <div className="space-y-1 pt-2">
              <label className="text-xs text-neutral-700">Band Expression</label>
              <input
                type="text"
                value={vizParams.expression || ''}
                onChange={(e) => update('expression', e.target.value || undefined)}
                placeholder="e.g. (B08-B04)/(B08+B04)"
                className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
              <p className="text-[11px] text-neutral-400">
                Math on asset bands. Overrides band selection for rendering.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Color Formula</label>
              <input
                type="text"
                value={vizParams.colorFormula || ''}
                onChange={(e) => update('colorFormula', e.target.value || undefined)}
                placeholder="e.g. gamma RGB 3.5 saturation 1.7"
                className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Resampling</label>
              <select
                value={vizParams.resampling || ''}
                onChange={(e) => update('resampling', e.target.value || undefined)}
                className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              >
                <option value="">Default (nearest)</option>
                <option value="bilinear">Bilinear</option>
                <option value="cubic">Cubic</option>
                <option value="lanczos">Lanczos</option>
                <option value="average">Average</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Mask Layer</label>
              <input
                type="text"
                value={vizParams.maskLayer ?? ''}
                onChange={(e) => update('maskLayer', e.target.value || undefined)}
                placeholder="e.g. SCL"
                className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
              <p className="text-[10px] text-neutral-400">
                Asset name used as pixel mask (e.g. SCL for Sentinel-2 Scene Classification)
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Mask Values (exclude)</label>
              <input
                type="text"
                value={vizParams.maskValues?.join(', ') ?? ''}
                onChange={(e) =>
                  update(
                    'maskValues',
                    e.target.value
                      ? e.target.value
                          .split(',')
                          .map((v) => parseInt(v.trim(), 10))
                          .filter((v) => !isNaN(v))
                      : undefined
                  )
                }
                placeholder="e.g. 0, 1, 8, 9, 10"
                className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
              <p className="text-[10px] text-neutral-400">
                Pixel values in the mask layer to exclude (clouds, nodata, shadows, etc.)
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Extra Tile Parameters</label>
              <input
                type="text"
                value={
                  vizParams.extraParams
                    ? Object.entries(vizParams.extraParams)
                        .map(([k, v]) => `${k}=${v}`)
                        .join('&')
                    : ''
                }
                onChange={(e) => {
                  const val = e.target.value.trim();
                  if (!val) {
                    update('extraParams', undefined);
                    return;
                  }
                  const params: Record<string, string> = {};
                  for (const pair of val.split('&')) {
                    const [k, ...rest] = pair.split('=');
                    if (k) params[k.trim()] = rest.join('=').trim();
                  }
                  update('extraParams', Object.keys(params).length > 0 ? params : undefined);
                }}
                placeholder="e.g. asset_bidx=image|1,2,3&post_process=..."
                className="w-full border border-neutral-200 rounded px-2 py-1.5 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
              <p className="text-[10px] text-neutral-400">
                Additional query parameters passed directly to the tiler. Format:
                key=value&key2=value2
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
