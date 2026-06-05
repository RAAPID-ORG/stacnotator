import { useState, useEffect, useMemo } from 'react';
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
import { normalizeColorFormula, validateColorFormula } from './vizValidation';
import { IconChevronDown, IconChevronUp } from '~/shared/ui/Icons';
import { InfoPopover } from '~/shared/ui/InfoPopover';
import { Input, Select } from '~/shared/ui/forms';

const TITILER_DOCS_URL = 'https://developmentseed.org/titiler/user_guide/rendering/';

const RescaleInfo = () => (
  <div className="space-y-2">
    <p className="font-semibold text-neutral-800">Rescale</p>
    <p>
      Rescaling adjusts the minimum and maximum values when rendering. In a single-band image the
      rescaled minimum maps to black and the maximum to white. Useful when you want to highlight
      features in a narrow value range (e.g. a DEM where you only care about 0–100m).
    </p>
    <p>
      Format: <code className="font-mono text-[10px]">rescale=&#123;min&#125;,&#123;max&#125;</code>
      . Multiple rescale values can be supplied per band.
    </p>
    <p>
      By default TiTiler rescales using the input datatype's min/max (e.g. 0–255 for 8-bit PNGs,
      0–65535 for 16-bit). For DEMs and similar this can wash the image out - set explicit rescale
      values that make sense for your data.
    </p>
    <p className="text-neutral-500 italic">
      Adapted from{' '}
      <a
        href={TITILER_DOCS_URL + '#rescaling'}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-600 hover:underline"
      >
        TiTiler documentation
      </a>
      .
    </p>
  </div>
);

const ColorFormulaInfo = () => (
  <div className="space-y-2">
    <p className="font-semibold text-neutral-800">Color Formula</p>
    <p>
      Comma-separated tone-mapping operations applied in order. Each op is{' '}
      <code className="font-mono text-[10px]">&lt;name&gt; &lt;bands&gt; &lt;args&gt;</code>. Bands
      are any combination of R/G/B (e.g. <code className="font-mono text-[10px]">RGB</code>,{' '}
      <code className="font-mono text-[10px]">RG</code>,{' '}
      <code className="font-mono text-[10px]">B</code>).
    </p>
    <p>Supported ops:</p>
    <ul className="list-disc pl-4 space-y-1">
      <li>
        <strong>gamma &lt;bands&gt; &lt;value&gt;</strong> - power-law correction. Values &gt; 1
        brighten midtones (darker → lighter); &lt; 1 darken. Typical: 1.5–3.5.
      </li>
      <li>
        <strong>saturation &lt;value&gt;</strong> - colour intensity. 1.0 = unchanged, &gt; 1 more
        vivid, &lt; 1 muted toward grayscale. Typical: 0.8–1.5. No bands arg.
      </li>
      <li>
        <strong>sigmoidal &lt;bands&gt; &lt;contrast&gt; &lt;bias&gt;</strong> - perceptual contrast
        curve. <em>contrast</em> 5–25 (higher = punchier); <em>bias</em> 0–1 (pivot point, 0.5 =
        center, &gt; 0.5 lifts shadows).
      </li>
    </ul>
    <p>
      Example:{' '}
      <code className="font-mono text-[10px]">
        gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55
      </code>{' '}
      (MPC's Landsat C2 L2 default).
    </p>
    <p className="text-neutral-500 italic">
      Commas between ops are required; the panel auto-inserts them on blur.{' '}
      <a
        href={TITILER_DOCS_URL + '#color-formula'}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-600 hover:underline"
      >
        TiTiler docs
      </a>
      .
    </p>
  </div>
);

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
  /** 'manual' = explicit min,max from preset or user; 'none' = no rescale, raw values served as-is */
  const [rescaleMode, setRescaleMode] = useState<'manual' | 'none'>(() => {
    if (vizParams.colorFormula && !vizParams.rescale) return 'none';
    return 'manual';
  });

  const rasterAssets = getRasterAssets(availableAssets);
  const presets = COLLECTION_PRESETS[collectionId] || [];
  const validPresets = presets.filter((p) =>
    p.assets.every((a) => rasterAssets.some(([k]) => k === a))
  );
  const knownRescale = KNOWN_RESCALE[collectionId];
  const defaultRescale = knownRescale || guessRescale(collectionId);

  // Auto-fill rescale on first render if known and in manual mode
  useEffect(() => {
    if (rescaleMode === 'manual' && !vizParams.rescale && defaultRescale) {
      onChange({ ...vizParams, rescale: defaultRescale });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = <K extends keyof VizParams>(key: K, value: VizParams[K]) => {
    onChange({ ...vizParams, [key]: value });
  };

  const colorFormulaError = useMemo(
    () => validateColorFormula(vizParams.colorFormula ?? ''),
    [vizParams.colorFormula]
  );

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
      setRescaleMode('manual');
    } else if (preset.colorFormula) {
      // Color formula handles tone mapping - no rescale needed
      updates.rescale = '';
      setRescaleMode('none');
    } else if (knownRescale) {
      updates.rescale = knownRescale;
      setRescaleMode('manual');
    }
    if (preset.expression) updates.expression = preset.expression;
    if (preset.colorFormula) {
      updates.colorFormula = preset.colorFormula;
    } else {
      updates.colorFormula = undefined;
    }
    updates.nodata = preset.nodata;
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
                      ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
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

      {/* Band picker (with asset metadata) - falls back to a text input when
          the collection's STAC metadata isn't loaded (e.g. editing a saved
          collection without re-fetching). */}
      {rasterAssets.length > 0 ? (
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
      ) : (
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Assets</label>
          <Input
            size="sm"
            type="text"
            value={vizParams.assets.join(', ')}
            onChange={(e) =>
              onChange({
                ...vizParams,
                assets: e.target.value
                  .split(',')
                  .map((a) => a.trim())
                  .filter(Boolean),
              })
            }
            placeholder="e.g. B04, B03, B02"
            className="font-mono"
          />
        </div>
      )}

      {/* Colormap */}
      {showColormap && (
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Colormap</label>
          <Select
            size="sm"
            value={vizParams.colormapName || 'viridis'}
            onChange={(e) => update('colormapName', e.target.value)}
          >
            {COLORMAPS.map((cm) => (
              <option key={cm.value} value={cm.value}>
                {cm.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Rescale */}
      <div className="space-y-1.5">
        <label className="text-xs text-neutral-700 font-medium flex items-center gap-1">
          Rescale
          <InfoPopover>
            <RescaleInfo />
          </InfoPopover>
        </label>
        <div className="flex gap-1.5">
          {(['manual', 'none'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setRescaleMode(mode);
                if (mode === 'manual' && !vizParams.rescale && defaultRescale) {
                  update('rescale', defaultRescale);
                } else if (mode === 'none') {
                  update('rescale', '');
                }
              }}
              className={`flex-1 text-xs px-2 py-1.5 rounded-md border transition-colors cursor-pointer ${
                rescaleMode === mode
                  ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                  : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
              }`}
            >
              {mode === 'manual' ? 'Manual' : 'None'}
            </button>
          ))}
        </div>
        {rescaleMode === 'manual' && (
          <>
            <Input
              size="sm"
              type="text"
              value={vizParams.rescale || ''}
              onChange={(e) => update('rescale', e.target.value)}
              placeholder={defaultRescale || 'e.g. 0,3000'}
            />
            <p className="text-[11px] text-neutral-400">
              Fixed min,max applied to each band.
              {defaultRescale ? ` Pre-filled from known defaults for this collection.` : ''}
            </p>
          </>
        )}
        {rescaleMode === 'none' && (
          <p className="text-[11px] text-neutral-500 bg-neutral-50 rounded-md px-3 py-1.5 border border-neutral-200">
            No rescaling - raw pixel values are served as-is. Use a color formula or ensure your
            data range maps to 0-255 for display.
          </p>
        )}
      </div>

      {/* Compositing (mosaic mode only) */}
      {showCompositing && (
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Compositing Method</label>
          <Select
            size="sm"
            value={vizParams.compositing || 'first'}
            onChange={(e) => update('compositing', e.target.value)}
          >
            <option value="first">First valid pixel</option>
            <option value="mean">Mean</option>
            <option value="median">Median</option>
            <option value="max">Maximum</option>
            <option value="min">Minimum</option>
            {collectionId.includes('sentinel-2') && (
              <option value="ndvi_best">Best NDVI pixel</option>
            )}
          </Select>
          {vizParams.compositing && vizParams.compositing !== 'first' && (
            <p className="text-[10px] text-amber-600 mt-1">
              Non-first-valid compositing reads multiple scenes per tile - expect ~10x slower data
              loading. For MPC this also routes through our self-hosted tiler instead of MPC's fast
              tile endpoint. Capped at 5 scenes per tile (lowest cloud cover first).
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
              <Input
                size="sm"
                type="text"
                value={vizParams.expression || ''}
                onChange={(e) => update('expression', e.target.value || undefined)}
                placeholder="e.g. (B08-B04)/(B08+B04)"
                className="font-mono"
              />
              <p className="text-[11px] text-neutral-400">
                Math on asset bands. Overrides band selection for rendering.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Nodata value</label>
              <Input
                size="sm"
                type="number"
                value={vizParams.nodata ?? ''}
                onChange={(e) =>
                  update('nodata', e.target.value === '' ? undefined : Number(e.target.value))
                }
                placeholder="e.g. 0"
                className="font-mono"
              />
              <p className="text-[11px] text-neutral-400">
                Pixel value to render transparent. Common: 0 for Landsat C2 L2 and Sentinel-2 L2A
                (fill / no-data).
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700 flex items-center gap-1">
                Color Formula
                <InfoPopover>
                  <ColorFormulaInfo />
                </InfoPopover>
              </label>
              <Input
                size="sm"
                type="text"
                invalid={!!colorFormulaError}
                value={vizParams.colorFormula || ''}
                onChange={(e) => update('colorFormula', e.target.value || undefined)}
                onBlur={(e) => {
                  const fixed = normalizeColorFormula(e.target.value);
                  if (fixed !== e.target.value) update('colorFormula', fixed || undefined);
                }}
                placeholder="e.g. gamma RGB 3.5, saturation 1.7"
                className="font-mono"
              />
              {colorFormulaError && <p className="text-[11px] text-red-600">{colorFormulaError}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Resampling</label>
              <Select
                size="sm"
                value={vizParams.resampling || ''}
                onChange={(e) => update('resampling', e.target.value || undefined)}
              >
                <option value="">Default (nearest)</option>
                <option value="bilinear">Bilinear</option>
                <option value="cubic">Cubic</option>
                <option value="lanczos">Lanczos</option>
                <option value="average">Average</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Mask Layer</label>
              <Input
                size="sm"
                type="text"
                value={vizParams.maskLayer ?? ''}
                onChange={(e) => update('maskLayer', e.target.value || undefined)}
                placeholder="e.g. SCL"
                className="font-mono"
              />
              <p className="text-[10px] text-neutral-400">
                Asset name used as pixel mask (e.g. SCL for Sentinel-2 Scene Classification)
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Mask Values (exclude)</label>
              <Input
                size="sm"
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
                className="font-mono"
              />
              <p className="text-[10px] text-neutral-400">
                Pixel values in the mask layer to exclude (clouds, nodata, shadows, etc.)
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">Extra Tile Parameters</label>
              <Input
                size="sm"
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
                className="font-mono"
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
