import { useState, useEffect, useMemo, useId, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
import { COMPOSITING_METHODS, noTilerNote } from './tilerCapabilities';
import { IconChevronDown, IconChevronUp } from '~/shared/ui/Icons';
import { InfoPopover } from '~/shared/ui/InfoPopover';
import { Input, Select } from '~/shared/ui/forms';

const TITILER_DOCS_URL = 'https://developmentseed.org/titiler/user_guide/rendering/';

const RescaleInfo = () => {
  const { t } = useTranslation('imagery');
  const code = <code className="font-mono text-[10px]" />;
  return (
    <div className="space-y-2">
      <p className="font-semibold text-neutral-800">{t('vizConfig.rescale.title')}</p>
      <p>{t('vizConfig.rescale.info.intro')}</p>
      <p>
        <Trans
          t={t}
          i18nKey="vizConfig.rescale.info.format"
          values={{ format: 'rescale={min},{max}' }}
          components={{ code }}
        />
      </p>
      <p>{t('vizConfig.rescale.info.defaults')}</p>
      <p className="text-neutral-500 italic">
        <Trans
          t={t}
          i18nKey="vizConfig.rescale.info.source"
          components={{ link: <DocsLink anchor="#rescaling" /> }}
        />
      </p>
    </div>
  );
};

const DocsLink = ({ anchor, children }: { anchor: string; children?: ReactNode }) => (
  <a
    href={TITILER_DOCS_URL + anchor}
    target="_blank"
    rel="noopener noreferrer"
    className="text-brand-600 hover:underline"
  >
    {children}
  </a>
);

const ColorFormulaInfo = () => {
  const { t } = useTranslation('imagery');
  const components = {
    code: <code className="font-mono text-[10px]" />,
    strong: <strong />,
    em: <em />,
  };
  return (
    <div className="space-y-2">
      <p className="font-semibold text-neutral-800">{t('vizConfig.colorFormula.title')}</p>
      <p>
        <Trans
          t={t}
          i18nKey="vizConfig.colorFormula.info.intro"
          components={components}
          shouldUnescape
        />
      </p>
      <p>{t('vizConfig.colorFormula.info.supported')}</p>
      <ul className="list-disc pl-4 space-y-1">
        <li>
          <Trans
            t={t}
            i18nKey="vizConfig.colorFormula.info.gamma"
            components={components}
            shouldUnescape
          />
        </li>
        <li>
          <Trans
            t={t}
            i18nKey="vizConfig.colorFormula.info.saturation"
            components={components}
            shouldUnescape
          />
        </li>
        <li>
          <Trans
            t={t}
            i18nKey="vizConfig.colorFormula.info.sigmoidal"
            components={components}
            shouldUnescape
          />
        </li>
      </ul>
      <p>
        <Trans
          t={t}
          i18nKey="vizConfig.colorFormula.info.example"
          values={{ example: 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55' }}
          components={components}
        />
      </p>
      <p className="text-neutral-500 italic">
        <Trans
          t={t}
          i18nKey="vizConfig.colorFormula.info.commas"
          components={{ link: <DocsLink anchor="#color-formula" /> }}
        />
      </p>
    </div>
  );
};

interface VizConfigPanelProps {
  collectionId: string;
  availableAssets: Record<string, AssetInfo>;
  vizParams: VizParams;
  onChange: (params: VizParams) => void;
  showCompositing?: boolean;
  /** Compositing methods the tiler serving this catalog can actually produce. */
  compositingMethods?: string[];
  /** The visualization's name; picking a preset renames it unless the user typed it. */
  name?: string;
  onNameChange?: (name: string) => void;
}

const GENERATED_NAME = /^Viz \d+$/;

export const VizConfigPanel = ({
  collectionId,
  availableAssets,
  vizParams,
  onChange,
  showCompositing = false,
  compositingMethods,
  name,
  onNameChange,
}: VizConfigPanelProps) => {
  const { t } = useTranslation('imagery');
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
    const nameIsDefault =
      !name || GENERATED_NAME.test(name) || presets.some((p) => p.label === name);
    if (nameIsDefault) onNameChange?.(preset.label);
  };

  const showColormap = activeRenderMode === 'single';

  return (
    <div className="space-y-4">
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-neutral-700 font-medium">{t('vizConfig.step1')}</legend>
        <p className="text-[11px] text-neutral-500">{t('vizConfig.step1Help')}</p>
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
              {mode === 'preset' ? t('vizConfig.usePreset') : t('vizConfig.custom')}
            </button>
          ))}
        </div>
        {!validPresets.length && (
          <p className="text-[11px] text-neutral-500">{t('vizConfig.noPresets')}</p>
        )}
      </fieldset>

      {setupMode === 'preset' && (
        <div className="space-y-1.5">
          <p className="text-xs text-neutral-700 font-medium">{t('vizConfig.choosePreset')}</p>
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
            <legend className="text-xs text-neutral-700 font-medium">{t('vizConfig.step2')}</legend>
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
                    {mode === 'single' ? t('vizConfig.singleBand') : 'RGB'}
                  </span>
                  <span className="block mt-1 text-[11px]">
                    {mode === 'single' ? t('vizConfig.singleHelp') : t('vizConfig.rgbHelp')}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {activeRenderMode && (
            <fieldset className="space-y-3">
              <legend className="text-xs text-neutral-700 font-medium mb-1.5">
                {activeRenderMode === 'single'
                  ? t('vizConfig.step3Single')
                  : t('vizConfig.step3Rgb')}
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
                        {mode === 'direct' ? t('vizConfig.direct') : t('vizConfig.calculated')}
                      </span>
                      <span className="block mt-1 text-[11px]">
                        {mode === 'direct'
                          ? t('vizConfig.directHelp')
                          : t('vizConfig.calculatedHelp')}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {isCalculation ? (
                <div className="rounded-md border border-brand-200 bg-brand-50 p-3 space-y-1">
                  <p className="text-xs text-neutral-700">
                    {activeRenderMode === 'single'
                      ? t('vizConfig.calcIntroSingle')
                      : t('vizConfig.calcIntroRgb')}
                  </p>
                  {rasterAssets.length ? (
                    <fieldset className="space-y-2 pt-2">
                      <legend className="text-xs font-medium text-neutral-700">
                        {t('vizConfig.inputAssets')}
                      </legend>
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
                        {t('vizConfig.inputAssets')}
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
                        placeholder={t('vizConfig.inputAssetsPlaceholder')}
                      />
                      <p className="text-[11px] text-neutral-500">
                        {t('vizConfig.noMetadataCalc')}
                      </p>
                    </div>
                  )}
                  <div className="space-y-1 pt-2">
                    <p className="text-xs font-medium text-neutral-700">
                      {t('vizConfig.inputBands')}
                    </p>
                    <p className="text-[11px] text-neutral-500">{t('vizConfig.inputBandsHelp')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {vizParams.assets.flatMap((asset) => {
                        const metadataBands = channelAssets[asset]?.bands;
                        const bands = metadataBands?.length
                          ? metadataBands
                          : [{ name: t('vizConfig.singleBand') }];
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
                              title={t('vizConfig.bandRefTitle', {
                                asset,
                                index: i + 1,
                                name: band.name,
                              })}
                              aria-label={t('vizConfig.insertRef', { reference })}
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
                    {t('vizConfig.bandFormula')}
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
                    placeholder={t('vizConfig.bandFormulaPlaceholder')}
                    className="font-mono"
                  />
                  <p className="text-[11px] text-neutral-500">
                    {activeRenderMode === 'single'
                      ? t('vizConfig.formulaHelpSingle')
                      : t('vizConfig.formulaHelp')}
                  </p>
                  {(!vizParams.assets.length || !vizParams.expression?.trim()) && (
                    <p className="text-[11px] text-amber-700">{t('vizConfig.formulaMissing')}</p>
                  )}
                  {activeRenderMode === 'single' && (
                    <div className="space-y-1 pt-2">
                      <label
                        htmlFor={`${id}-calculation-range`}
                        className="text-xs font-medium text-neutral-700"
                      >
                        {t('vizConfig.displayRange')}
                      </label>
                      <Input
                        id={`${id}-calculation-range`}
                        size="sm"
                        value={vizParams.rescale}
                        onChange={(e) => {
                          setRescaleMode(e.target.value ? 'manual' : 'none');
                          update('rescale', e.target.value);
                        }}
                        placeholder={t('vizConfig.minMaxPlaceholder')}
                      />
                      <p className="text-[11px] text-neutral-500">
                        {t('vizConfig.displayRangeHelp')}
                      </p>
                    </div>
                  )}
                  {activeRenderMode === 'rgb' && (
                    <button
                      type="button"
                      onClick={() => changeRenderMode('rgb')}
                      className="text-xs text-brand-700 underline cursor-pointer"
                    >
                      {t('vizConfig.useDirect')}
                    </button>
                  )}
                </div>
              ) : rasterAssets.length > 0 ? (
                <>
                  <p className="text-[11px] text-neutral-500">{t('vizConfig.channelsHelp')}</p>
                  {(activeRenderMode === 'rgb'
                    ? [t('vizConfig.red'), t('vizConfig.green'), t('vizConfig.blue')]
                    : [t('vizConfig.singleBand')]
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
                              {t('vizConfig.asset')}
                            </label>
                            <Select
                              id={`${id}-asset-${index}`}
                              aria-label={t('vizConfig.assetAria', { label })}
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
                              <option value="">{t('vizConfig.chooseAsset')}</option>
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
                              {t('vizConfig.band')}
                            </label>
                            <Select
                              id={`${id}-band-${index}`}
                              aria-label={t('vizConfig.bandAria', { label })}
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
                                <option value="">{t('vizConfig.chooseAssetFirst')}</option>
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
                                <option value={1}>1: {t('vizConfig.singleBand')}</option>
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
                        ? t('vizConfig.channelsMissingRgb')
                        : t('vizConfig.channelsMissingSingle')}
                    </p>
                  )}
                </>
              ) : (
                <div className="space-y-1">
                  <p className="text-[11px] text-neutral-500">
                    {activeRenderMode === 'rgb'
                      ? t('vizConfig.noMetadataRgb')
                      : t('vizConfig.noMetadataSingle')}
                  </p>
                  <label htmlFor={`${id}-assets`} className="text-xs text-neutral-700 font-medium">
                    {t('vizConfig.assets')}
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
                      activeRenderMode === 'rgb'
                        ? t('vizConfig.assetsPlaceholderRgb')
                        : t('vizConfig.assetsPlaceholderSingle')
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
                {t('vizConfig.colorScale')}
              </label>
              <Select
                id={`${id}-colormap`}
                size="sm"
                value={vizParams.colormapName || ''}
                onChange={(e) => update('colormapName', e.target.value || undefined)}
              >
                <option value="">{t('vizConfig.noColorScale')}</option>
                {COLORMAPS.map((cm) => (
                  <option key={cm.value} value={cm.value}>
                    {t(cm.label)}
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
          <label className="text-xs text-neutral-700 font-medium">
            {t('vizConfig.compositing')}
          </label>
          <Select
            size="sm"
            value={vizParams.compositing || 'first'}
            onChange={(e) => update('compositing', e.target.value)}
            disabled={offeredMethods.length < 2}
          >
            {offeredMethods.map((m) => (
              <option key={m.value} value={m.value}>
                {t(m.label)}
              </option>
            ))}
          </Select>
          {offeredMethods.length < 2 && (
            <p className="text-[10px] text-neutral-500 mt-1">
              {t('vizConfig.firstValidOnly', { note: noTilerNote() })}
            </p>
          )}
          {vizParams.compositing && vizParams.compositing !== 'first' && (
            <p className="text-[10px] text-amber-600 mt-1">{t('vizConfig.slowCompositing')}</p>
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
          <span className="text-xs text-neutral-700 font-medium">
            {t('vizConfig.advancedOptions')}
          </span>
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
                {t('vizConfig.savedBidx', { bidx: vizParams.bidx.join(', ') })}
              </p>
            )}
            {activeRenderMode === 'rgb' && !isCalculation && (
              <div className="space-y-1 pt-2">
                <label htmlFor={`${id}-rgb-expression`} className="text-xs text-neutral-700">
                  {t('vizConfig.bandExpression')}
                </label>
                <Input
                  id={`${id}-rgb-expression`}
                  size="sm"
                  type="text"
                  value={vizParams.expression || ''}
                  onChange={(e) => update('expression', e.target.value || undefined)}
                  placeholder={t('vizConfig.bandExpressionPlaceholder')}
                  className="font-mono"
                />
                <p className="text-[11px] text-neutral-400">{t('vizConfig.bandExpressionHelp')}</p>
              </div>
            )}

            {/* Rescale */}
            <div className="space-y-1.5 pt-3">
              <label className="text-xs text-neutral-700 flex items-center gap-1">
                {t('vizConfig.rescale.title')}
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
                    {mode === 'manual'
                      ? t('vizConfig.rescale.manual')
                      : t('vizConfig.rescale.none')}
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
                    placeholder={defaultRescale || t('vizConfig.rescale.placeholder')}
                  />
                  <p className="text-[11px] text-neutral-400">
                    {defaultRescale
                      ? t('vizConfig.rescale.helpPrefilled')
                      : t('vizConfig.rescale.help')}
                  </p>
                </>
              )}
              {rescaleMode === 'none' && (
                <p className="text-[11px] text-neutral-500 bg-neutral-50 rounded-md px-3 py-1.5 border border-neutral-200">
                  {t('vizConfig.rescale.noneHelp')}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">{t('vizConfig.nodata')}</label>
              <Input
                size="sm"
                type="number"
                value={vizParams.nodata ?? ''}
                onChange={(e) =>
                  update('nodata', e.target.value === '' ? undefined : Number(e.target.value))
                }
                placeholder={t('vizConfig.nodataPlaceholder')}
                className="font-mono"
              />
              <p className="text-[11px] text-neutral-400">{t('vizConfig.nodataHelp')}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700 flex items-center gap-1">
                {t('vizConfig.colorFormula.title')}
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
                placeholder={t('vizConfig.colorFormula.placeholder')}
                className="font-mono"
              />
              {colorFormulaError && <p className="text-[11px] text-red-600">{colorFormulaError}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">{t('vizConfig.resampling.label')}</label>
              <Select
                size="sm"
                value={vizParams.resampling || ''}
                onChange={(e) => update('resampling', e.target.value || undefined)}
              >
                <option value="">{t('vizConfig.resampling.default')}</option>
                <option value="bilinear">{t('vizConfig.resampling.bilinear')}</option>
                <option value="cubic">{t('vizConfig.resampling.cubic')}</option>
                <option value="lanczos">Lanczos</option>
                <option value="average">{t('vizConfig.resampling.average')}</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">{t('vizConfig.maskLayer')}</label>
              <Input
                size="sm"
                type="text"
                value={vizParams.maskLayer ?? ''}
                onChange={(e) => update('maskLayer', e.target.value || undefined)}
                placeholder={t('vizConfig.maskLayerPlaceholder')}
                className="font-mono"
              />
              <p className="text-[10px] text-neutral-400">{t('vizConfig.maskLayerHelp')}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">{t('vizConfig.maskValues')}</label>
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
                placeholder={t('vizConfig.maskValuesPlaceholder')}
                className="font-mono"
              />
              <p className="text-[10px] text-neutral-400">{t('vizConfig.maskValuesHelp')}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700">{t('vizConfig.extraParams')}</label>
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
                placeholder={t('vizConfig.extraParamsPlaceholder')}
                className="font-mono"
              />
              <p className="text-[10px] text-neutral-400">{t('vizConfig.extraParamsHelp')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
