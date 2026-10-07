import { useState, useEffect, useMemo } from 'react';
import {
  COLLECTION_PRESETS,
  KNOWN_RESCALE,
  COLORMAPS,
  decodeChannels,
  encodeChannels,
  getRasterAssets,
  isPreRenderedRGB,
  guessRescale,
} from './collectionPresets';
import type { BandPreset, AssetInfo, Channel } from './collectionPresets';
import type { VizParams } from './types';
import { normalizeColorFormula, validateColorFormula } from './vizValidation';
import { COMPOSITING_METHODS, NO_TILER_NOTE } from './tilerCapabilities';
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
  /** Compositing methods the tiler serving this catalog can actually produce. */
  compositingMethods?: string[];
}

export const VizConfigPanel = ({
  collectionId,
  availableAssets,
  vizParams,
  onChange,
  showCompositing = false,
  compositingMethods,
}: VizConfigPanelProps) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isRgbAsset, setIsRgbAsset] = useState(false);
  /** 'manual' = explicit min,max from preset or user; 'none' = no rescale, raw values served as-is */
  const [rescaleMode, setRescaleMode] = useState<'manual' | 'none'>(() => {
    if (vizParams.colorFormula && !vizParams.rescale) return 'none';
    return 'manual';
  });

  const rasterAssets = getRasterAssets(availableAssets);

  // Up to 3 output channels, each a band of some asset: a single-band asset is picked
  // directly, a multiband one opens its band list. A multiband asset saved without bidx
  // (e.g. a pre-rendered `visual` preset) renders whole and is shown as such.
  const isMultiband = (key: string) => (availableAssets[key]?.bands?.length ?? 0) > 1;
  const wholeAsset =
    !vizParams.bidx?.length && vizParams.assets.length === 1 && isMultiband(vizParams.assets[0])
      ? vizParams.assets[0]
      : undefined;
  const channels = wholeAsset
    ? []
    : decodeChannels(vizParams.assets, vizParams.bidx, availableAssets);
  const [openAsset, setOpenAsset] = useState(
    () => wholeAsset ?? channels.find((c) => isMultiband(c.asset))?.asset
  );
  const bandChoices = openAsset
    ? (availableAssets[openAsset]?.bands ?? [])
        .map((b, i) => ({ name: b.name, band: i + 1 }))
        // Alpha is a transparency mask, not a display band - exclude it from the picker.
        .filter((b) => b.name.toLowerCase() !== 'alpha')
    : [];
  const channelName = ({ asset, band }: Channel) =>
    isMultiband(asset) ? `${asset}/${availableAssets[asset].bands![band - 1].name}` : asset;
  // How many output bands are selected (drives RGB-vs-single-band / colormap logic).
  const selCount = wholeAsset ? 1 : channels.length;

  // Best-NDVI needs red/NIR bands to rank pixels by, so it is only meaningful on the
  // collections we know carry them.
  const offeredMethods = COMPOSITING_METHODS.filter(
    (m) =>
      (compositingMethods ?? COMPOSITING_METHODS.map((c) => c.value)).includes(m.value) &&
      (m.value !== 'ndvi_best' || collectionId.includes('sentinel-2'))
  );

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

  const channelIndex = (asset: string, band: number) =>
    channels.findIndex((c) => c.asset === asset && c.band === band);

  const toggleChannel = (channel: Channel) => {
    const pos = channelIndex(channel.asset, channel.band);
    let next = channels;
    if (pos >= 0) next = channels.filter((_, i) => i !== pos);
    else if (channels.length < 3) next = [...channels, channel];
    const { assets, bidx } = encodeChannels(next, availableAssets);
    onChange({ ...vizParams, assets, bidx, assetAsBand: !bidx && assets.length === 3 });
  };

  const clickAsset = (key: string) => {
    if (isMultiband(key)) setOpenAsset(openAsset === key ? undefined : key);
    else toggleChannel({ asset: key, band: 1 });
  };

  const applyPreset = (preset: BandPreset) => {
    const updates: Partial<VizParams> = {
      assets: preset.assets,
      // bidx presets pick bands within one asset; asset_as_band doesn't apply there.
      assetAsBand: preset.bidx ? false : preset.assets.length === 3 || !!preset.expression,
      bidx: preset.bidx,
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
    if (vizParams.expression) return '';
    if (selCount === 1) return 'S';
    return ['R', 'G', 'B'][i] || '';
  };

  const bandColorClass = (i: number) => {
    // Expression mode: the selected assets are the expression's inputs, not RGB.
    if (vizParams.expression) return 'bg-brand-50 border-brand-400 text-brand-700';
    if (selCount === 1) return 'bg-purple-100 border-purple-400 text-purple-800';
    return (
      [
        'bg-red-100 border-red-400 text-red-800',
        'bg-green-100 border-green-400 text-green-800',
        'bg-blue-100 border-blue-400 text-blue-800',
      ][i] || ''
    );
  };

  // A colormap only applies to single-band output. An expression is a
  // comma-separated list of band expressions (one output band per term), so it
  // qualifies only when it has a single term (e.g. NDVI). Otherwise it's the
  // single-selected-asset case.
  const expressionBands = vizParams.expression
    ? vizParams.expression.split(',').filter((t) => t.trim()).length
    : 0;
  const showColormap =
    !isRgbAsset && (expressionBands === 1 || (expressionBands === 0 && selCount === 1));

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
                p.assets.every((a, j) => a === vizParams.assets[j]) &&
                JSON.stringify(p.bidx ?? null) === JSON.stringify(vizParams.bidx ?? null);
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

      {/* Channel picker; without STAC metadata it falls back to a text input (e.g. editing
          a saved collection without re-fetching). */}
      {rasterAssets.length > 0 ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-neutral-700 font-medium">
              Bands{' '}
              <span className="font-normal text-neutral-500">
                Select 1 (colorized) or 3 (RGB); open a multiband asset to pick its bands
              </span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {rasterAssets.map(([key, info]) => {
                const multiband = isMultiband(key);
                const positions = channels.flatMap((c, i) => (c.asset === key ? [i] : []));
                const used = positions.length > 0 || wholeAsset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => clickAsset(key)}
                    aria-expanded={multiband ? openAsset === key : undefined}
                    title={info.title || key}
                    className={`relative text-xs px-2 py-1 rounded border transition-colors cursor-pointer ${
                      !used
                        ? 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                        : multiband
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : bandColorClass(positions[0])
                    } ${openAsset === key ? 'ring-1 ring-brand-400' : ''}`}
                  >
                    {positions.length > 0 && (
                      <span className="absolute -top-1.5 -left-1 text-[9px] font-bold leading-none">
                        {positions.map(bandLabel).join('')}
                      </span>
                    )}
                    {info.title || key}
                    {multiband && (
                      <span className="ml-1 text-neutral-500">
                        {info.bands!.length} bands {openAsset === key ? '-' : '+'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {openAsset && bandChoices.length > 0 && (
            <div className="space-y-1.5 pl-2 border-l-2 border-brand-200">
              <label className="text-xs text-neutral-700 font-medium">Bands of {openAsset}</label>
              <div className="flex flex-wrap gap-1.5">
                {bandChoices.map(({ name, band }) => {
                  const pos = channelIndex(openAsset, band);
                  return (
                    <button
                      key={band}
                      type="button"
                      onClick={() => toggleChannel({ asset: openAsset, band })}
                      title={`band ${band}: ${name}`}
                      className={`relative text-xs px-2 py-1 rounded border transition-colors cursor-pointer ${
                        pos >= 0
                          ? bandColorClass(pos)
                          : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                      }`}
                    >
                      {pos >= 0 && (
                        <span className="absolute -top-1.5 -left-1 text-[9px] font-bold leading-none">
                          {bandLabel(pos)}
                        </span>
                      )}
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="text-[11px] text-neutral-500">
            {vizParams.expression ? (
              <>Expression inputs (colorized by the expression below)</>
            ) : wholeAsset ? (
              isRgbAsset ? (
                `Pre-rendered RGB: ${wholeAsset}`
              ) : (
                `All bands of ${wholeAsset}`
              )
            ) : (
              <>
                {channels.length === 0 && 'No bands selected'}
                {channels.length === 1 && `Single band: ${channelName(channels[0])} (colorized)`}
                {channels.length === 2 && 'Select a 3rd band for RGB, or remove one'}
                {channels.length === 3 && (
                  <>
                    RGB: <span className="text-red-600">{channelName(channels[0])}</span> /{' '}
                    <span className="text-green-600">{channelName(channels[1])}</span> /{' '}
                    <span className="text-blue-600">{channelName(channels[2])}</span>
                  </>
                )}
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

      {/* Compositing (mosaic mode only) */}
      {showCompositing && (
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Compositing Method</label>
          <Select
            size="sm"
            value={vizParams.compositing || 'first'}
            onChange={(e) => update('compositing', e.target.value)}
            disabled={offeredMethods.length < 2}
          >
            {offeredMethods.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
          {offeredMethods.length < 2 && (
            <p className="text-[10px] text-neutral-500 mt-1">
              Only first-valid compositing is available for this catalog. {NO_TILER_NOTE}
            </p>
          )}
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
            {showColormap && (
              <div className="space-y-1 pt-2">
                <label className="text-xs text-neutral-700">Colormap</label>
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

            {/* Rescale */}
            <div className="space-y-1.5">
              <label className="text-xs text-neutral-700 flex items-center gap-1">
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
                  No rescaling - raw pixel values are served as-is. Use a color formula or ensure
                  your data range maps to 0-255 for display.
                </p>
              )}
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
