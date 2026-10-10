import { useState, useEffect, useMemo, useId } from 'react';
import {
  COLLECTION_PRESETS,
  KNOWN_RESCALE,
  COLORMAPS,
  decodeChannels,
  encodeChannels,
  getRasterAssets,
  isPreRenderedRGB,
  guessRescale,
  presetVizParams,
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
  const id = useId();
  const [setupMode, setSetupMode] = useState<'preset' | 'custom' | undefined>(() => {
    if (!vizParams.assets.length && !vizParams.expression) return undefined;
    const matchesPreset = (COLLECTION_PRESETS[collectionId] ?? []).some(
      (preset) =>
        JSON.stringify(preset.assets) === JSON.stringify(vizParams.assets) &&
        JSON.stringify(preset.bidx ?? null) === JSON.stringify(vizParams.bidx ?? null) &&
        (preset.expression ?? '') === (vizParams.expression ?? '') &&
        (preset.extraParams?.asset_bidx ?? '') === (vizParams.extraParams?.asset_bidx ?? '')
    );
    return matchesPreset ? 'preset' : 'custom';
  });
  const [pendingMapping, setPendingMapping] = useState<{
    channels: (Channel | undefined)[];
    assets: string[];
    bidx?: number[];
    mode: 'single' | 'rgb';
  }>();
  const [singleBandMode, setSingleBandMode] = useState<'direct' | 'calculated'>();
  /** 'manual' = explicit min,max from preset or user; 'none' = no rescale, raw values served as-is */
  const [rescaleMode, setRescaleMode] = useState<'manual' | 'none'>(() => {
    if (vizParams.colorFormula && !vizParams.rescale) return 'none';
    return 'manual';
  });

  const rasterAssets = getRasterAssets(availableAssets);

  const channelAssets: Record<string, AssetInfo> = Object.fromEntries(
    rasterAssets.map(([key, info]) => [
      key,
      !info.bands?.length && isPreRenderedRGB(key, info.roles)
        ? { ...info, bands: ['Red', 'Green', 'Blue'].map((name) => ({ name })) }
        : info,
    ])
  );
  const legacyAssetBands = vizParams.extraParams?.asset_bidx?.split('|');
  const selectedBands =
    vizParams.bidx ??
    (legacyAssetBands && legacyAssetBands[0] === vizParams.assets[0]
      ? legacyAssetBands[1]?.split(',').map(Number)
      : undefined);
  const wholeRgbAsset =
    !selectedBands?.length &&
    vizParams.assets.length === 1 &&
    (isPreRenderedRGB(vizParams.assets[0], availableAssets[vizParams.assets[0]]?.roles) ||
      availableAssets[vizParams.assets[0]]?.bands?.length === 3);
  const decodedChannels = wholeRgbAsset
    ? [1, 2, 3].map((band) => ({ asset: vizParams.assets[0], band }))
    : decodeChannels(vizParams.assets, selectedBands, channelAssets);
  const activeMapping =
    !vizParams.expression &&
    pendingMapping &&
    JSON.stringify(pendingMapping.assets) === JSON.stringify(vizParams.assets) &&
    JSON.stringify(pendingMapping.bidx) === JSON.stringify(vizParams.bidx)
      ? pendingMapping
      : undefined;
  const channels = activeMapping?.channels ?? decodedChannels;
  const expressionBands = vizParams.expression
    ? vizParams.expression.split(',').filter((term) => term.trim()).length
    : 0;
  const activeRenderMode =
    singleBandMode === 'calculated'
      ? 'single'
      : expressionBands
        ? expressionBands === 1
          ? 'single'
          : 'rgb'
        : (activeMapping?.mode ??
          (selectedBands?.length === 3 || decodedChannels.length === 3
            ? 'rgb'
            : vizParams.assets.length
              ? 'single'
              : undefined));
  const isCalculation = !!vizParams.expression || singleBandMode === 'calculated';

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

  const writeChannels = (next: (Channel | undefined)[], mode: 'single' | 'rgb') => {
    const wasCalculated = !!vizParams.expression || singleBandMode === 'calculated';
    const complete = next.every((channel) => !!channel);
    const { assets, bidx } = encodeChannels(
      complete ? next.filter((channel): channel is Channel => !!channel) : [],
      channelAssets
    );
    setPendingMapping({ channels: next, assets, bidx, mode });
    const extraParams = { ...vizParams.extraParams };
    delete extraParams.asset_bidx;
    onChange({
      ...vizParams,
      assets,
      bidx,
      assetAsBand: !bidx && assets.length === 3,
      expression: undefined,
      rescale: wasCalculated ? (defaultRescale ?? '') : vizParams.rescale,
      colorFormula: wasCalculated ? undefined : vizParams.colorFormula,
      colormapName: mode === 'single' ? vizParams.colormapName : undefined,
      extraParams: Object.keys(extraParams).length ? extraParams : undefined,
    });
    if (wasCalculated) setRescaleMode(defaultRescale ? 'manual' : 'none');
  };

  const changeRenderMode = (mode: 'single' | 'rgb') => {
    setSingleBandMode('direct');
    const next = Array.from({ length: mode === 'rgb' ? 3 : 1 }, (_, i) =>
      vizParams.expression ? undefined : channels[i]
    );
    writeChannels(next, mode);
  };

  const writeCalculation = (assets: string[]) => {
    if (activeRenderMode === 'single') setSingleBandMode('calculated');
    const assetAsBand = assets.every(
      (asset) => Math.max(channelAssets[asset]?.bands?.length ?? 0, 1) === 1
    );
    let nextExpression = vizParams.expression;
    if (assetAsBand !== vizParams.assetAsBand && nextExpression) {
      const replacements = new Map(
        rasterAssets
          .filter(([, info]) => (info.bands?.length ?? 1) <= 1)
          .map(([asset]) => [
            vizParams.assetAsBand ? asset : `${asset}_b1`,
            assetAsBand ? asset : `${asset}_b1`,
          ])
      );
      if (replacements.size) {
        const names = [...replacements.keys()].map((name) =>
          name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
        nextExpression = nextExpression.replace(
          new RegExp(`\\b(${names.join('|')})\\b`, 'g'),
          (name) => replacements.get(name)!
        );
      }
    }
    const extraParams = { ...vizParams.extraParams };
    delete extraParams.asset_bidx;
    setPendingMapping(undefined);
    onChange({
      ...vizParams,
      assets,
      expression: nextExpression || undefined,
      assetAsBand,
      bidx: undefined,
      extraParams: Object.keys(extraParams).length ? extraParams : undefined,
    });
  };

  const changeSingleBandMode = (mode: 'direct' | 'calculated') => {
    setSingleBandMode(mode);
    if (mode === 'direct') changeRenderMode('single');
    else writeCalculation(vizParams.assets);
  };

  const changeChannel = (index: number, channel: Channel | undefined) => {
    const mode = activeRenderMode ?? 'single';
    const next = Array.from({ length: mode === 'rgb' ? 3 : 1 }, (_, i) => channels[i]);
    next[index] = channel;
    writeChannels(next, mode);
  };

  const applyPreset = (preset: BandPreset) => {
    const params = presetVizParams(preset, collectionId, vizParams);
    setRescaleMode(params.rescale ? 'manual' : 'none');

    setPendingMapping(undefined);
    setSingleBandMode(undefined);
    onChange(params);
  };

  const showColormap = activeRenderMode === 'single';

  return (
    <div className="space-y-4">
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-neutral-700 font-medium">
          1. Start with a preset or customize
        </legend>
        <p className="text-[11px] text-neutral-500">
          Presets fill in rendering and bands for you. Custom lets you map them yourself.
        </p>
        <div className="flex gap-2">
          {(['preset', 'custom'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={setupMode === mode}
              disabled={mode === 'preset' && !validPresets.length}
              onClick={() => setSetupMode(mode)}
              className={`flex-1 text-xs px-3 py-2 rounded-md border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                setupMode === mode
                  ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                  : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {mode === 'preset' ? 'Use a preset' : 'Custom'}
            </button>
          ))}
        </div>
        {!validPresets.length && (
          <p className="text-[11px] text-neutral-500">
            No presets are available for these assets. Choose Custom to configure the display.
          </p>
        )}
      </fieldset>

      {setupMode === 'preset' && (
        <div className="space-y-1.5">
          <p className="text-xs text-neutral-700 font-medium">Choose a preset</p>
          <div className="flex flex-wrap gap-1.5">
            {validPresets.map((p, i) => {
              const isActive =
                p.assets.length === vizParams.assets.length &&
                p.assets.every((a, j) => a === vizParams.assets[j]) &&
                JSON.stringify(p.bidx ?? null) === JSON.stringify(vizParams.bidx ?? null) &&
                (p.expression ?? '') === (vizParams.expression ?? '') &&
                (p.extraParams?.asset_bidx ?? '') === (vizParams.extraParams?.asset_bidx ?? '');
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={isActive}
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

      {setupMode && (setupMode === 'custom' || vizParams.assets.length > 0) && (
        <>
          <fieldset className="space-y-1.5">
            <legend className="text-xs text-neutral-700 font-medium">
              2. How should this visualization be displayed?
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(['single', 'rgb'] as const).map((mode) => (
                <label
                  key={mode}
                  className={`text-xs p-2.5 rounded-md border cursor-pointer ${
                    activeRenderMode === mode
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-neutral-200 text-neutral-600'
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name={`${id}-render-mode`}
                      checked={activeRenderMode === mode}
                      onChange={() => changeRenderMode(mode)}
                    />
                    {mode === 'single' ? 'Single band' : 'RGB'}
                  </span>
                  <span className="block mt-1 text-[11px]">
                    {mode === 'single'
                      ? 'One value, shown in grayscale or with a color scale.'
                      : 'Three bands mapped to red, green, and blue.'}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {activeRenderMode && (
            <fieldset className="space-y-3">
              <legend className="text-xs text-neutral-700 font-medium mb-1.5">
                {activeRenderMode === 'single'
                  ? '3. Choose the single-band source'
                  : '3. Map assets and bands to rendering channels'}
              </legend>
              {activeRenderMode === 'single' && (
                <div className="grid grid-cols-2 gap-2">
                  {(['direct', 'calculated'] as const).map((mode) => (
                    <label
                      key={mode}
                      className={`text-xs p-2.5 rounded-md border cursor-pointer ${
                        isCalculation === (mode === 'calculated')
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-neutral-200 text-neutral-600'
                      }`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <input
                          type="radio"
                          name={`${id}-single-band-mode`}
                          checked={isCalculation === (mode === 'calculated')}
                          onChange={() => changeSingleBandMode(mode)}
                        />
                        {mode === 'direct' ? 'Use an existing band' : 'Calculate a band'}
                      </span>
                      <span className="block mt-1 text-[11px]">
                        {mode === 'direct'
                          ? 'Display one band from an imagery asset.'
                          : 'Combine input bands with a formula, such as NDVI.'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {isCalculation ? (
                <div className="rounded-md border border-brand-200 bg-brand-50 p-3 space-y-1">
                  <p className="text-xs text-neutral-700">
                    Choose the input assets, then combine their bands in a formula. The result is
                    displayed{' '}
                    {activeRenderMode === 'single'
                      ? 'as one band with the color scale below'
                      : 'in RGB'}
                    .
                  </p>
                  {rasterAssets.length ? (
                    <fieldset className="space-y-2 pt-2">
                      <legend className="text-xs font-medium text-neutral-700">Input assets</legend>
                      {rasterAssets.map(([asset, info]) => (
                        <label
                          key={asset}
                          className="flex items-center gap-2 text-xs text-neutral-700"
                        >
                          <input
                            type="checkbox"
                            checked={vizParams.assets.includes(asset)}
                            onChange={(e) =>
                              writeCalculation(
                                e.target.checked
                                  ? [...vizParams.assets, asset]
                                  : vizParams.assets.filter((key) => key !== asset)
                              )
                            }
                          />
                          {info.title ? `${info.title} (${asset})` : asset}
                        </label>
                      ))}
                    </fieldset>
                  ) : (
                    <div className="space-y-1 pt-2">
                      <label
                        htmlFor={`${id}-calculation-assets`}
                        className="text-xs text-neutral-700"
                      >
                        Input assets
                      </label>
                      <Input
                        id={`${id}-calculation-assets`}
                        size="sm"
                        value={vizParams.assets.join(', ')}
                        onChange={(e) => {
                          setPendingMapping(undefined);
                          onChange({
                            ...vizParams,
                            assets: e.target.value
                              .split(',')
                              .map((asset) => asset.trim())
                              .filter(Boolean),
                          });
                        }}
                        placeholder="e.g. B08, B04"
                      />
                      <p className="text-[11px] text-neutral-500">
                        Asset metadata is unavailable. Existing calculation settings are preserved.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1 pt-2">
                    <p className="text-xs font-medium text-neutral-700">Input bands</p>
                    <p className="text-[11px] text-neutral-500">
                      Click a band reference to append it to the formula, or type it directly.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {vizParams.assets.flatMap((asset) => {
                        const metadataBands = channelAssets[asset]?.bands;
                        const bands = metadataBands?.length
                          ? metadataBands
                          : [{ name: 'Single band' }];
                        return bands.flatMap((band, i) => {
                          if (band.name.toLowerCase() === 'alpha') return [];
                          const reference = vizParams.assetAsBand ? asset : `${asset}_b${i + 1}`;
                          return (
                            <button
                              key={`${asset}-${i}`}
                              type="button"
                              onClick={() =>
                                update('expression', `${vizParams.expression ?? ''}${reference}`)
                              }
                              title={`${asset}, band ${i + 1}: ${band.name}`}
                              aria-label={`Insert ${reference} into formula`}
                              className="text-xs font-mono px-2 py-1 rounded border border-brand-200 bg-white text-brand-700 cursor-pointer"
                            >
                              {reference}
                              {bands.length > 1 ? ` (${band.name})` : ''}
                            </button>
                          );
                        });
                      })}
                    </div>
                  </div>
                  <label
                    htmlFor={`${id}-expression`}
                    className="block pt-2 text-xs font-medium text-neutral-700"
                  >
                    Band formula
                  </label>
                  <Input
                    id={`${id}-expression`}
                    size="sm"
                    type="text"
                    value={vizParams.expression ?? ''}
                    onChange={(e) => {
                      if (activeRenderMode === 'single') setSingleBandMode('calculated');
                      update('expression', e.target.value || undefined);
                    }}
                    placeholder="e.g. (B08-B04)/(B08+B04)"
                    className="font-mono"
                  />
                  <p className="text-[11px] text-neutral-500">
                    Use +, -, *, / and parentheses to combine the input bands.
                    {activeRenderMode === 'single' &&
                      ' Enter one formula for the single output band.'}
                  </p>
                  {(!vizParams.assets.length || !vizParams.expression?.trim()) && (
                    <p className="text-[11px] text-amber-700">
                      Choose input assets and enter a formula to calculate the band.
                    </p>
                  )}
                  {activeRenderMode === 'single' && (
                    <div className="space-y-1 pt-2">
                      <label
                        htmlFor={`${id}-calculation-range`}
                        className="text-xs font-medium text-neutral-700"
                      >
                        Display range (min, max)
                      </label>
                      <Input
                        id={`${id}-calculation-range`}
                        size="sm"
                        value={vizParams.rescale}
                        onChange={(e) => {
                          setRescaleMode(e.target.value ? 'manual' : 'none');
                          update('rescale', e.target.value);
                        }}
                        placeholder="min,max"
                      />
                      <p className="text-[11px] text-neutral-500">
                        Set the calculated values mapped to the ends of the color scale.
                      </p>
                    </div>
                  )}
                  {activeRenderMode === 'rgb' && (
                    <button
                      type="button"
                      onClick={() => changeRenderMode('rgb')}
                      className="text-xs text-brand-700 underline cursor-pointer"
                    >
                      Use direct band mapping instead
                    </button>
                  )}
                </div>
              ) : rasterAssets.length > 0 ? (
                <>
                  <p className="text-[11px] text-neutral-500">
                    Choose an asset (imagery file) for each channel, then a band if that asset
                    contains multiple bands. The same asset can supply several channels.
                  </p>
                  {(activeRenderMode === 'rgb'
                    ? ['Red (R)', 'Green (G)', 'Blue (B)']
                    : ['Single band']
                  ).map((label, index) => {
                    const channel = channels[index];
                    const info = channel ? channelAssets[channel.asset] : undefined;
                    const bands = info?.bands ?? [];
                    return (
                      <div
                        key={label}
                        className="rounded-md border border-neutral-200 p-2.5 space-y-2"
                      >
                        <p className="text-xs font-medium text-neutral-700">{label}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label
                              htmlFor={`${id}-asset-${index}`}
                              className="text-xs text-neutral-600"
                            >
                              Asset
                            </label>
                            <Select
                              id={`${id}-asset-${index}`}
                              aria-label={`${label} asset`}
                              size="sm"
                              value={channel?.asset ?? ''}
                              onChange={(e) => {
                                const asset = e.target.value;
                                const firstBand = channelAssets[asset]?.bands?.findIndex(
                                  (band) => band.name.toLowerCase() !== 'alpha'
                                );
                                changeChannel(
                                  index,
                                  asset
                                    ? {
                                        asset,
                                        band:
                                          firstBand !== undefined && firstBand >= 0
                                            ? firstBand + 1
                                            : 1,
                                      }
                                    : undefined
                                );
                              }}
                            >
                              <option value="">Choose an asset</option>
                              {rasterAssets.map(([key, asset]) => (
                                <option key={key} value={key}>
                                  {asset.title ? `${asset.title} (${key})` : key}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <label
                              htmlFor={`${id}-band-${index}`}
                              className="text-xs text-neutral-600"
                            >
                              Band
                            </label>
                            <Select
                              id={`${id}-band-${index}`}
                              aria-label={`${label} band`}
                              size="sm"
                              disabled={!channel || bands.length < 2}
                              value={channel?.band ?? ''}
                              onChange={(e) => {
                                if (channel)
                                  changeChannel(index, {
                                    ...channel,
                                    band: Number(e.target.value),
                                  });
                              }}
                            >
                              {!channel ? (
                                <option value="">Choose an asset first</option>
                              ) : bands.length ? (
                                bands.map(
                                  (band, i) =>
                                    band.name.toLowerCase() !== 'alpha' && (
                                      <option key={i} value={i + 1}>
                                        {i + 1}: {band.name}
                                        {band.description ? ` - ${band.description}` : ''}
                                      </option>
                                    )
                                )
                              ) : (
                                <option value={1}>1: Single band</option>
                              )}
                            </Select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {Array.from(
                    { length: activeRenderMode === 'rgb' ? 3 : 1 },
                    (_, i) => channels[i]
                  ).some((channel) => !channel) && (
                    <p className="text-[11px] text-amber-700">
                      {activeRenderMode === 'rgb'
                        ? 'Choose an asset and band for all three RGB channels.'
                        : 'Choose the asset and band to display.'}
                    </p>
                  )}
                </>
              ) : (
                <div className="space-y-1">
                  <p className="text-[11px] text-neutral-500">
                    Asset metadata is unavailable. Enter asset keys in rendering order:
                    {activeRenderMode === 'rgb' ? ' red, green, blue.' : ' one single-band asset.'}
                    Existing band indexes are preserved in Advanced Options.
                  </p>
                  <label htmlFor={`${id}-assets`} className="text-xs text-neutral-700 font-medium">
                    Assets
                  </label>
                  <Input
                    id={`${id}-assets`}
                    size="sm"
                    type="text"
                    value={vizParams.assets.join(', ')}
                    onChange={(e) => {
                      setPendingMapping(undefined);
                      const assets = e.target.value
                        .split(',')
                        .map((asset) => asset.trim())
                        .filter(Boolean);
                      onChange({
                        ...vizParams,
                        assets,
                        assetAsBand: !vizParams.bidx?.length && assets.length === 3,
                      });
                    }}
                    placeholder={
                      activeRenderMode === 'rgb' ? 'e.g. B04, B03, B02' : 'e.g. elevation'
                    }
                    className="font-mono"
                  />
                </div>
              )}
            </fieldset>
          )}

          {showColormap && (
            <div className="space-y-1">
              <label htmlFor={`${id}-colormap`} className="text-xs text-neutral-700 font-medium">
                Color scale
              </label>
              <Select
                id={`${id}-colormap`}
                size="sm"
                value={vizParams.colormapName || ''}
                onChange={(e) => update('colormapName', e.target.value || undefined)}
              >
                <option value="">Grayscale (no color scale)</option>
                {COLORMAPS.map((cm) => (
                  <option key={cm.value} value={cm.value}>
                    {cm.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </>
      )}

      {/* Compositing (mosaic mode only) */}
      {setupMode && activeRenderMode && showCompositing && (
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
      <div
        hidden={!setupMode || !activeRenderMode}
        className="rounded-md border border-neutral-200"
      >
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
            {!rasterAssets.length && vizParams.bidx?.length && (
              <p className="text-[11px] text-neutral-500 pt-2">
                Saved band indexes: {vizParams.bidx.join(', ')}. Asset metadata is needed to change
                the band mapping.
              </p>
            )}
            {activeRenderMode === 'rgb' && !isCalculation && (
              <div className="space-y-1 pt-2">
                <label htmlFor={`${id}-rgb-expression`} className="text-xs text-neutral-700">
                  Band Expression
                </label>
                <Input
                  id={`${id}-rgb-expression`}
                  size="sm"
                  type="text"
                  value={vizParams.expression || ''}
                  onChange={(e) => update('expression', e.target.value || undefined)}
                  placeholder="Comma-separated formulas for red, green, blue"
                  className="font-mono"
                />
                <p className="text-[11px] text-neutral-400">
                  Math on asset bands. Overrides band selection for rendering.
                </p>
              </div>
            )}

            {/* Rescale */}
            <div className="space-y-1.5 pt-3">
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
