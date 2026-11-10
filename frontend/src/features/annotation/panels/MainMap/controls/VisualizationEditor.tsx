import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createVisualizationFromEdit,
  editVisualization,
  getCampaignWithImageryWindows,
  type CampaignOutFull,
  type CollectionVisualizationOut,
  type ImagerySourceOut,
  type VisualizationPatch,
} from '~/api/client';
import { COLLECTION_PRESETS, presetVizParams } from '~/features/layers/imagery/collectionPresets';
import {
  normalizeColorFormula,
  validateColorFormula,
} from '~/features/layers/imagery/vizValidation';
import { COLORMAPS, gradientFor } from '~/shared/colormaps/colormaps';
import {
  parseColorFormula,
  withColorAdjust,
  parseRescale,
  type ColorAdjust,
} from '~/shared/imagery/colorAdjust';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { IconClose, IconReset, IconSliders, IconTrash } from '~/shared/ui/Icons';
import { SegmentedControl } from '~/shared/ui/SegmentedControl';
import { handleError } from '~/shared/utils/errorHandler';
import type { SliceAddress } from '../../../campaign/imageryNav';
import {
  isStacCollection,
  patchedParams,
  type VisualizationEdit,
  type VisualizationEdits,
} from '../../../campaign/visualizationEdits';
import { useCampaign, useCampaignStore } from '../../../stores/campaign';
import { useImageryStore } from '../../../stores/imagery';
import { usePrefsStore } from '../../../stores/prefs';

const COMMIT_DELAY_MS = 250;
const RESAMPLING = ['nearest', 'bilinear', 'cubic', 'cubic_spline', 'lanczos', 'average', 'mode'];

type BandMode = 'rgb' | 'single' | 'index';

interface Target {
  source: ImagerySourceOut;
  stacCollectionId: string;
  vizId: number;
  name: string;
  /** The saved visualization's parameters this one is drawn over. */
  base: CollectionVisualizationOut;
  baseVizId: number;
  /** Set when the viewer made this visualization themselves. */
  copy: VisualizationEdit['copy'] | null;
  rows: CollectionVisualizationOut[];
}

/** What the map shows, when it is a STAC visualization the viewer may redraw. */
function editTarget(
  campaign: CampaignOutFull,
  edits: VisualizationEdits,
  address: SliceAddress | null
): Target | null {
  if (!address) return null;
  const source = campaign.imagery_sources.find((s) => s.id === address.sourceId);
  const collection = source?.collections.find((c) => c.id === address.collectionId);
  if (!source || !collection || !isStacCollection(collection)) return null;
  const vizId = Number(address.vizId);
  const copy = edits[vizId]?.copy ?? null;
  const baseVizId = copy ? copy.baseId : vizId;
  const rows = collection.visualizations ?? [];
  const base = rows.find((row) => row.visualization_id === baseVizId);
  const name = copy?.name ?? source.visualizations.find((viz) => viz.id === vizId)?.name;
  if (!base || !name) return null;
  return {
    source,
    stacCollectionId: collection.search!.stac_collection_id,
    vizId,
    name,
    base,
    baseVizId,
    copy,
    rows,
  };
}

function useEditTarget(): Target | null {
  const campaign = useCampaign();
  const edits = usePrefsStore((s) => s.visualizationEdits);
  const address = useImageryStore((s) => s.address);
  const showBasemap = useImageryStore((s) => s.showBasemap);
  return useMemo(
    () => (showBasemap ? null : editTarget(campaign, edits, address)),
    [campaign, edits, address, showBasemap]
  );
}

export function VisualizationEditorToggle({ title }: { title: string }) {
  const open = useImageryStore((s) => s.vizEditorOpen);
  const toggle = useImageryStore((s) => s.toggleVizEditor);
  if (!useEditTarget()) return null;
  return (
    <button
      type="button"
      data-testid="viz-editor-toggle"
      aria-pressed={open}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => toggle()}
      title={title}
      className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-neutral-100 ${open ? 'bg-neutral-100 text-brand-600' : 'text-neutral-500 hover:text-neutral-700'}`}
    >
      <IconSliders className="h-[13px] w-[13px]" />
    </button>
  );
}

export function VisualizationEditor() {
  const open = useImageryStore((s) => s.vizEditorOpen);
  const target = useEditTarget();
  if (!open || !target) return null;
  return <EditorCard key={target.vizId} target={target} />;
}

const outputBands = (params: Record<string, unknown>): number => {
  const expression = typeof params.expression === 'string' ? params.expression : '';
  if (expression) return expression.split(',').filter((term) => term.trim()).length || 1;
  const bidx = Array.isArray(params.bidx) ? params.bidx : [];
  const assets = Array.isArray(params.assets) ? params.assets : [];
  return bidx.length || Math.max(assets.length, 1);
};

const modeOf = (params: Record<string, unknown>): BandMode =>
  params.expression ? 'index' : outputBands(params) === 1 ? 'single' : 'rgb';

const isEmpty = (patch: VisualizationPatch) => Object.keys(patch).length === 0;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function refreshImagery(campaignId: number) {
  const { data } = await getCampaignWithImageryWindows({
    path: { campaign_id: campaignId },
    throwOnError: true,
  });
  const current = useCampaignStore.getState().campaign;
  if (!data || current?.id !== campaignId) return;
  useCampaignStore.getState().setCampaign({
    ...current,
    imagery_sources: data.imagery_sources,
    imagery_renew_at: data.imagery_renew_at,
    registration_status: data.registration_status,
    registration_errors: data.registration_errors,
  });
}

function EditorCard({ target }: { target: Target }) {
  const { t } = useTranslation('panels');
  const campaign = useCampaign();
  const edits = usePrefsStore((s) => s.visualizationEdits);
  const prefs = usePrefsStore.getState;
  const close = () => useImageryStore.getState().toggleVizEditor(false);

  const stored = edits[target.vizId]?.patch ?? {};
  const [draft, setDraft] = useState<VisualizationPatch>(stored);
  const [mode, setMode] = useState<BandMode>(() =>
    modeOf(patchedParams(target.base.params, stored) ?? target.base.params)
  );
  const [expressionText, setExpressionText] = useState(() =>
    String(patchedParams(target.base.params, stored)?.expression ?? '')
  );
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<VisualizationPatch | null>(null);

  const write = (patch: VisualizationPatch) => {
    const current = prefs().visualizationEdits[target.vizId];
    if (!current?.copy && isEmpty(patch)) prefs().resetVisualizationEdit(target.vizId);
    else prefs().setVisualizationEdit(target.vizId, { ...current, patch });
  };
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) write(pending.current);
    pending.current = null;
  };
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (change: VisualizationPatch) => {
    const next = { ...draft, ...change };
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, COMMIT_DELAY_MS);
  };
  const replace = (next: VisualizationPatch) => {
    setDraft(next);
    pending.current = next;
    flush();
  };

  const params = (patchedParams(target.base.params, draft) ?? target.base.params) as Record<
    string,
    unknown
  > & { assets?: string[]; bidx?: number[] | null; expression?: string | null };
  const drawable = patchedParams(target.base.params, draft) !== null;
  const edited = !isEmpty(draft);

  const presets = useMemo(
    () => COLLECTION_PRESETS[target.stacCollectionId] ?? [],
    [target.stacCollectionId]
  );
  const assetChoices = useMemo(() => {
    const names = new Set<string>();
    for (const row of target.rows) {
      for (const asset of (row.params.assets as string[] | undefined) ?? []) names.add(asset);
    }
    for (const preset of presets) for (const asset of preset.assets) names.add(asset);
    return [...names];
  }, [target.rows, presets]);

  const assets = params.assets ?? [];
  const bidx = params.bidx ?? null;
  const baseRange = parseRescale(target.base.params.rescale as string | undefined);
  const range = parseRescale(params.rescale as string | undefined);
  const adjust = parseColorFormula(params.color_formula as string | undefined);

  const applyPreset = (index: number) => {
    const preset = presets[index];
    if (!preset) return;
    const viz = presetVizParams(preset, target.stacCollectionId);
    setExpressionText(viz.expression ?? '');
    setMode(
      viz.expression ? 'index' : (viz.bidx?.length ?? viz.assets.length) === 1 ? 'single' : 'rgb'
    );
    update({
      assets: viz.assets,
      asset_as_band: viz.assetAsBand,
      bidx: viz.bidx ?? null,
      expression: viz.expression ?? null,
      rescale: viz.rescale || null,
      colormap_name: viz.colormapName ?? null,
      color_formula: viz.colorFormula ?? null,
      nodata: viz.nodata ?? null,
      extra_params: viz.extraParams ?? null,
    });
  };

  const switchMode = (next: BandMode) => {
    setMode(next);
    if (next === 'index') {
      const preset = presets.find((p) => p.expression);
      if (preset) applyPreset(presets.indexOf(preset));
      return;
    }
    if (next === 'single') {
      update({
        expression: null,
        ...(bidx?.length ? { bidx: [bidx[0]] } : { assets: [assets[0] ?? assetChoices[0]] }),
        colormap_name: (params.colormap_name as string | undefined) ?? 'viridis',
      });
      return;
    }
    const three = [0, 1, 2].map((i) => assets[i] ?? assetChoices[i] ?? assetChoices[0]);
    update({
      expression: null,
      colormap_name: null,
      ...(bidx?.length
        ? { bidx: [0, 1, 2].map((i) => bidx[i] ?? bidx[0]) }
        : { assets: three, bidx: null }),
    });
  };

  const setChannel = (index: number, value: string) => {
    if (bidx?.length) {
      const next = [...bidx];
      next[index] = Number(value);
      update({ bidx: next });
    } else {
      const next = [...assets];
      next[index] = value;
      update({ assets: next });
    }
  };

  const setExpression = (expression: string) => {
    setExpressionText(expression);
    const used = assetChoices.filter((asset) =>
      new RegExp(`\\b${escapeRegExp(asset)}\\b`).test(expression)
    );
    update({
      expression: expression.trim() || null,
      asset_as_band: true,
      bidx: null,
      ...(used.length ? { assets: used } : {}),
    });
  };

  const setAdjust = (change: Partial<ColorAdjust>) =>
    update({
      color_formula: withColorAdjust(params.color_formula as string | undefined, {
        ...adjust,
        ...change,
      }),
    });

  const nameTaken = (name: string) =>
    target.source.visualizations.some((viz) => viz.name === name) ||
    Object.entries(edits).some(
      ([id, { copy }]) =>
        copy?.sourceId === target.source.id && copy.name === name && Number(id) !== target.vizId
    );

  const removeAdded = () => {
    const address = useImageryStore.getState().address;
    if (address) {
      useImageryStore.getState().setAddress({ ...address, vizId: String(target.baseVizId) });
    }
    prefs().resetVisualizationEdit(target.vizId);
  };

  const saveForEveryone = async () => {
    flush();
    setSaving(true);
    try {
      if (target.copy) {
        const { data } = await createVisualizationFromEdit({
          path: { campaign_id: campaign.id, source_id: target.source.id },
          body: { name: target.name, base_visualization_id: target.baseVizId, patch: draft },
          throwOnError: true,
        });
        await refreshImagery(campaign.id);
        const address = useImageryStore.getState().address;
        if (address) useImageryStore.getState().setAddress({ ...address, vizId: String(data.id) });
        prefs().resetVisualizationEdit(target.vizId);
      } else {
        await editVisualization({
          path: { campaign_id: campaign.id, visualization_id: target.vizId },
          body: { patch: draft },
          throwOnError: true,
        });
        await refreshImagery(campaign.id);
        setDraft({});
        prefs().resetVisualizationEdit(target.vizId);
      }
      setConfirming(false);
    } catch (error) {
      handleError(error, t('vizEditor.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const channelLabels = [t('vizEditor.red'), t('vizEditor.green'), t('vizEditor.blue')];
  const channelCount = mode === 'rgb' ? 3 : 1;

  return (
    <div
      className="absolute right-2 top-2 z-10 flex max-h-[calc(100%-1rem)] w-60 flex-col rounded-lg bg-white/95 text-xs text-neutral-700 shadow-lg backdrop-blur-sm"
      data-testid="viz-editor"
      data-edited={edited}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
        <IconSliders className="h-4 w-4 text-neutral-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            {t('vizEditor.title')}
          </div>
          {target.copy ? (
            <input
              aria-label={t('vizEditor.name')}
              data-testid="viz-editor-name"
              value={target.name}
              onChange={(e) => {
                const name = e.target.value;
                if (target.copy && name.trim() && !nameTaken(name)) {
                  prefs().setVisualizationEdit(target.vizId, {
                    patch: draft,
                    copy: { ...target.copy, name },
                  });
                }
              }}
              className="w-full truncate rounded border border-transparent bg-transparent text-[13px] font-medium text-neutral-900 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none"
            />
          ) : (
            <div className="truncate text-[13px] font-medium text-neutral-900">
              {target.name}
              {edited && (
                <span className="ml-1.5 rounded bg-brand-50 px-1 text-[10px] font-normal text-brand-700">
                  {t('vizEditor.edited')}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={t('vizEditor.close')}
          title={t('vizEditor.close')}
          className="cursor-pointer rounded p-0.5 text-neutral-400 hover:text-neutral-700"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        <section className="space-y-1.5">
          <div className="flex items-center gap-2">
            <SectionHeading>{t('vizEditor.bands')}</SectionHeading>
            <SegmentedControl<BandMode>
              aria-label={t('vizEditor.bands')}
              data-testid="viz-editor-mode"
              size="compact"
              value={mode}
              onChange={switchMode}
              segments={[
                { value: 'rgb', label: t('vizEditor.mode.rgb') },
                { value: 'single', label: t('vizEditor.mode.single') },
                { value: 'index', label: t('vizEditor.mode.index') },
              ]}
            />
          </div>
          {mode === 'index' ? (
            <input
              value={expressionText}
              data-testid="viz-editor-expression"
              aria-label={t('vizEditor.expression')}
              placeholder={t('vizEditor.expressionPlaceholder')}
              onChange={(e) => setExpression(e.target.value)}
              className={`${inputClass} w-full font-mono`}
            />
          ) : (
            <div className="flex gap-1.5">
              {Array.from({ length: channelCount }, (_, i) => (
                <label key={i} className="flex min-w-0 flex-1 items-center gap-1">
                  {mode === 'rgb' && (
                    <span className="w-2.5 shrink-0 text-[10px] font-semibold text-neutral-500">
                      {channelLabels[i]}
                    </span>
                  )}
                  {bidx?.length ? (
                    <input
                      type="number"
                      min={1}
                      value={bidx[i] ?? ''}
                      aria-label={t('vizEditor.band', { channel: channelLabels[i] })}
                      onChange={(e) => e.target.value && setChannel(i, e.target.value)}
                      className={`${inputClass} w-full`}
                    />
                  ) : (
                    <select
                      value={assets[i] ?? ''}
                      aria-label={t('vizEditor.band', { channel: channelLabels[i] })}
                      onChange={(e) => setChannel(i, e.target.value)}
                      className={`${selectClass} min-w-0`}
                    >
                      {assetChoices.map((asset) => (
                        <option key={asset} value={asset}>
                          {asset}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              ))}
            </div>
          )}
          {!drawable && <p className="text-[10px] text-red-600">{t('vizEditor.nothingToDraw')}</p>}
        </section>

        <RangeControl
          value={range}
          base={baseRange ?? (mode === 'index' ? [-1, 1] : [0, 3000])}
          onChange={(next) => update({ rescale: next ? `${next[0]},${next[1]}` : null })}
        />

        {mode !== 'rgb' && (
          <section className="space-y-1.5">
            <SectionHeading>{t('vizEditor.colormap')}</SectionHeading>
            <div
              className="grid grid-cols-3 gap-1"
              role="radiogroup"
              aria-label={t('vizEditor.colormap')}
            >
              {[null, ...COLORMAPS].map((name) => {
                const selected = (params.colormap_name ?? null) === name;
                return (
                  <button
                    key={name ?? 'none'}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`viz-editor-colormap-${name ?? 'none'}`}
                    onClick={() => update({ colormap_name: name })}
                    className={`flex cursor-pointer flex-col items-stretch gap-0.5 rounded p-1 text-[10px] ${selected ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-400' : 'text-neutral-600 hover:bg-neutral-100'}`}
                  >
                    <span
                      className="h-2 rounded-sm"
                      style={{ background: gradientFor(name ?? '') }}
                    />
                    <span className="truncate">{name ?? t('vizEditor.greyscale')}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="space-y-1.5">
          <SectionHeading>{t('vizEditor.colour')}</SectionHeading>
          <Slider
            label={t('vizEditor.gamma')}
            testId="viz-editor-gamma"
            min={0.2}
            max={3}
            step={0.05}
            value={adjust.gamma}
            onChange={(gamma) => setAdjust({ gamma })}
          />
          <Slider
            label={t('vizEditor.contrast')}
            testId="viz-editor-contrast"
            min={0}
            max={20}
            step={0.5}
            value={adjust.contrast}
            onChange={(contrast) => setAdjust({ contrast })}
          />
          <Slider
            label={t('vizEditor.saturation')}
            testId="viz-editor-saturation"
            min={0}
            max={3}
            step={0.05}
            value={adjust.saturation}
            onChange={(saturation) => setAdjust({ saturation })}
          />
        </section>

        <details className="group">
          <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-neutral-500 hover:text-neutral-700">
            {t('vizEditor.advanced')}
          </summary>
          <div className="mt-2 space-y-2">
            <Row label={t('vizEditor.resampling')}>
              <select
                value={(params.resampling as string | undefined) ?? ''}
                onChange={(e) => update({ resampling: e.target.value || null })}
                className={selectClass}
              >
                <option value="">{t('vizEditor.resamplingDefault')}</option>
                {RESAMPLING.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('vizEditor.nodata')}>
              <input
                type="number"
                value={(params.nodata as number | undefined) ?? ''}
                onChange={(e) =>
                  update({ nodata: e.target.value === '' ? null : Number(e.target.value) })
                }
                className={`${inputClass} w-full`}
              />
            </Row>
            <FormulaInput
              key={String(params.color_formula ?? '')}
              value={(params.color_formula as string | undefined) ?? ''}
              onCommit={(formula) => update({ color_formula: formula || null })}
            />
          </div>
        </details>
      </div>

      <div className="flex items-center gap-1 border-t border-neutral-100 px-3 py-1.5 text-[10px] text-neutral-500">
        <IconButton
          testId="viz-editor-reset"
          title={t('vizEditor.resetTitle')}
          disabled={!edited}
          onClick={() => {
            replace({});
            setMode(modeOf(target.base.params));
            setExpressionText((target.base.params.expression as string | undefined) ?? '');
          }}
        >
          <IconReset className="h-3.5 w-3.5" />
        </IconButton>
        {target.copy && (
          <IconButton
            testId="viz-editor-delete"
            title={t('vizEditor.deleteTitle')}
            onClick={removeAdded}
            danger
          >
            <IconTrash className="h-3.5 w-3.5" />
          </IconButton>
        )}
        <p className="ml-1 min-w-0 flex-1 leading-tight">
          {target.copy ? t('vizEditor.onlyYouAdded') : t('vizEditor.onlyYou')}
        </p>
        {campaign.viewer_is_admin && drawable && (target.copy || edited) && (
          <button
            type="button"
            data-testid="viz-editor-save-everyone"
            title={t('vizEditor.applyToAllTitle')}
            onClick={() => setConfirming(true)}
            disabled={saving}
            className="shrink-0 cursor-pointer underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 disabled:cursor-not-allowed"
          >
            {t('vizEditor.applyToAll')}
          </button>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirming}
        title={t('vizEditor.confirmTitle')}
        description={
          target.copy
            ? t('vizEditor.confirmCreate', { name: target.name })
            : t('vizEditor.confirmEdit', { name: target.name })
        }
        confirmText={t('vizEditor.saveForEveryone')}
        isLoading={saving}
        onConfirm={saveForEveryone}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

const inputClass =
  'h-6 rounded border border-neutral-200 bg-white px-1.5 text-xs focus:border-brand-400 focus:outline-none';
const selectClass = `${inputClass} w-full cursor-pointer`;

function IconButton({
  testId,
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  testId: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent ${danger ? 'text-red-500 hover:text-red-600' : 'text-neutral-500 hover:text-neutral-700'}`}
    >
      {children}
    </button>
  );
}

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
    {children}
  </div>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex items-center gap-2">
    <span className="w-16 shrink-0 text-[11px] text-neutral-500">{label}</span>
    <span className="min-w-0 flex-1">{children}</span>
  </label>
);

function Slider({
  label,
  testId,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  testId: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-neutral-500">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 cursor-pointer accent-brand-500"
      />
      <span className="w-8 text-right tabular-nums text-[10px] text-neutral-500">
        {Math.round(value * 100) / 100}
      </span>
    </label>
  );
}

function RangeControl({
  value,
  base,
  onChange,
}: {
  value: [number, number] | null;
  base: [number, number];
  onChange: (value: [number, number] | null) => void;
}) {
  const { t } = useTranslation('panels');
  // The slider spans the campaign's own range and as much again either side, fixed
  // while dragging so the handles do not run away from the pointer.
  const span = Math.abs(base[1] - base[0]) || 1;
  const domain: [number, number] = [base[0] - span, base[1] + span];
  const step = span / 200;
  const [lo, hi] = value ?? base;
  const set = (index: 0 | 1, next: number) => {
    if (!Number.isFinite(next)) return;
    onChange(index === 0 ? [next, hi] : [lo, next]);
  };

  return (
    <section className="space-y-1.5">
      <SectionHeading>{t('vizEditor.range')}</SectionHeading>
      {([0, 1] as const).map((index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[11px] text-neutral-500">
            {index === 0 ? t('vizEditor.min') : t('vizEditor.max')}
          </span>
          <input
            type="range"
            min={domain[0]}
            max={domain[1]}
            step={step}
            value={index === 0 ? lo : hi}
            data-testid={`viz-editor-range-${index === 0 ? 'min' : 'max'}`}
            aria-label={index === 0 ? t('vizEditor.min') : t('vizEditor.max')}
            onChange={(e) => set(index, Number(e.target.value))}
            className="min-w-0 flex-1 cursor-pointer accent-brand-500"
          />
          <input
            type="number"
            value={index === 0 ? lo : hi}
            aria-label={index === 0 ? t('vizEditor.min') : t('vizEditor.max')}
            onChange={(e) => e.target.value !== '' && set(index, Number(e.target.value))}
            className={`${inputClass} w-14 tabular-nums`}
          />
        </div>
      ))}
    </section>
  );
}

function FormulaInput({ value, onCommit }: { value: string; onCommit: (formula: string) => void }) {
  const { t } = useTranslation('panels');
  const [text, setText] = useState(value);
  const error = validateColorFormula(text);
  const commit = () => {
    if (error) return;
    const normalized = normalizeColorFormula(text);
    if (normalized !== value) onCommit(normalized);
  };
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-neutral-500">{t('vizEditor.colorFormula')}</span>
      <input
        value={text}
        data-testid="viz-editor-formula"
        aria-label={t('vizEditor.colorFormula')}
        placeholder={t('vizEditor.formulaPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={`${inputClass} w-full font-mono ${error ? 'border-red-400' : ''}`}
      />
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
