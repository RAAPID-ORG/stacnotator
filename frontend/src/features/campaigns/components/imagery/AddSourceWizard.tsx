import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Modal } from '~/shared/ui/Modal';
import { Input, Button } from '~/shared/ui/forms';
import { IconStac, IconChevronRight } from '~/shared/ui/Icons';
import { CatalogBrowser, MPC_PRESETS } from './CatalogBrowser';
import type { CatalogBrowserPreset, CatalogBrowserResult } from './CatalogBrowser';
import { CollectionEditor } from './CollectionEditor';
import { PlanetBrowser } from './PlanetBrowser';
import { PlanetSceneBrowser } from './PlanetSceneBrowser';
import type { CollectionItem, ImagerySource, NamedVizParams } from './types';
import { emptyManualCollection, emptySource } from './types';
import type { ImageryController } from './controller';

interface AddSourceWizardProps {
  controller: ImageryController;
  onClose: () => void;
  /** Called with the new source id right after it's created, so the caller can
   *  open it for editing immediately. */
  onCreated?: (sourceId: string) => void;
}

type WizardStep =
  | { kind: 'pick-preset' }
  | { kind: 'configure-preset'; preset: CatalogBrowserPreset }
  | { kind: 'planet-mosaics' }
  | { kind: 'planet-scenes' }
  | { kind: 'custom-stac-question' }
  | { kind: 'custom-stac-browse' }
  | { kind: 'custom-xyz' };

const PRESET_BLURBS = {
  'sentinel-2-l2a': 'wizard.blurbs.sentinel2',
  'landsat-c2-l2': 'wizard.blurbs.landsat',
  'hls2-s30': 'wizard.blurbs.hlsS30',
  'hls2-l30': 'wizard.blurbs.hlsL30',
  naip: 'wizard.blurbs.naip',
  'sentinel-1-grd': 'wizard.blurbs.sentinel1',
  'cop-dem-glo-30': 'wizard.blurbs.copDem',
} as const;

const isBlurbId = (id: string): id is keyof typeof PRESET_BLURBS => id in PRESET_BLURBS;

export const AddSourceWizard = ({ controller, onClose, onCreated }: AddSourceWizardProps) => {
  const { t } = useTranslation('imagery');
  const [step, setStep] = useState<WizardStep>({ kind: 'pick-preset' });

  /** Every flow finishes the same way: the source is created, then handed to the
   *  caller so it can be opened for editing. */
  const added = async (source: ImagerySource) => {
    await controller.addSource(source);
    if (onCreated) onCreated(source.id);
    else onClose();
  };

  const back = () => {
    if (
      step.kind === 'configure-preset' ||
      step.kind === 'planet-mosaics' ||
      step.kind === 'planet-scenes' ||
      step.kind === 'custom-stac-question'
    ) {
      setStep({ kind: 'pick-preset' });
    } else if (step.kind === 'custom-stac-browse' || step.kind === 'custom-xyz') {
      setStep({ kind: 'custom-stac-question' });
    }
  };

  const finalizeFromCatalog = async (result: CatalogBrowserResult, fallbackName: string) => {
    const { collections, generationSeries } = result;
    if (collections.length === 0) return;
    const first = collections[0];
    const vizNames: NamedVizParams[] | undefined =
      first.data.type === 'stac_browser' ? first.data.visualizations : undefined;

    const src = emptySource();
    src.name = fallbackName;
    if (vizNames && vizNames.length > 0) {
      src.visualizations = vizNames.map((v) => ({ name: v.name }));
    }
    src.generationSeries = generationSeries ? [generationSeries] : [];
    src.collections = collections;

    await added(src);
  };

  if (step.kind === 'configure-preset') {
    return (
      <CatalogBrowser
        projectId={controller.projectId}
        preset={step.preset}
        initialMode="mosaic"
        campaignBbox={controller.campaignBbox}
        onAdd={(result) => finalizeFromCatalog(result, step.preset.label)}
        onClose={back}
      />
    );
  }

  if (step.kind === 'custom-stac-browse') {
    return (
      <CatalogBrowser
        projectId={controller.projectId}
        initialMode="mosaic"
        campaignBbox={controller.campaignBbox}
        allowPrivateCatalogs={controller.allowsPrivateCatalogs}
        onAdd={(result) => {
          const { collections: cols } = result;
          const fallback =
            cols[0]?.data.type === 'stac_browser'
              ? cols[0].data.stacCollectionId
              : t('wizard.customImageryName');
          finalizeFromCatalog(result, fallback);
        }}
        onClose={back}
      />
    );
  }

  if (step.kind === 'planet-mosaics') {
    return <PlanetBrowser projectId={controller.projectId} onAdd={added} onClose={back} />;
  }

  if (step.kind === 'planet-scenes') {
    return <PlanetSceneBrowser projectId={controller.projectId} onAdd={added} onClose={back} />;
  }

  if (step.kind === 'custom-xyz') {
    return <CustomXyzStep projectId={controller.projectId} onBack={back} onConfirm={added} />;
  }

  const title = step.kind === 'pick-preset' ? t('wizard.title') : t('wizard.customTitle');

  return (
    <Modal title={title} onClose={onClose} maxWidth="max-w-xl">
      <div className="p-4 space-y-3">
        {step.kind !== 'pick-preset' && (
          <button
            type="button"
            onClick={back}
            className="text-xs text-neutral-500 hover:text-neutral-700 cursor-pointer"
          >
            {t('wizard.back')}
          </button>
        )}

        {step.kind === 'pick-preset' && (
          <>
            <p className="text-xs text-neutral-500">{t('wizard.pickIntro')}</p>
            <div className="grid gap-1.5">
              <button
                type="button"
                onClick={() => setStep({ kind: 'custom-stac-question' })}
                className="text-left px-4 py-3 rounded-lg border border-dashed border-neutral-300 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <IconChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                  <span className="text-sm font-medium text-neutral-900">
                    {t('wizard.custom.title')}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mt-1 leading-snug">
                  {t('wizard.custom.description')}
                </p>
              </button>
              {MPC_PRESETS.map((preset) => (
                <button
                  key={preset.stacCollectionId}
                  type="button"
                  onClick={() => setStep({ kind: 'configure-preset', preset })}
                  className="text-left px-4 py-3 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <IconStac className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span className="text-sm font-medium text-neutral-900">{preset.label}</span>
                    <span className="ml-auto text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">
                      MPC
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-1 leading-snug">
                    {isBlurbId(preset.stacCollectionId)
                      ? t(PRESET_BLURBS[preset.stacCollectionId])
                      : ''}
                  </p>
                  <p className="text-[10px] text-neutral-400 mt-0.5 font-mono">
                    {preset.stacCollectionId}
                  </p>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStep({ kind: 'planet-mosaics' })}
                className="text-left px-4 py-3 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <IconStac className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                  <span className="text-sm font-medium text-neutral-900">
                    {t('wizard.planetBasemaps.title')}
                  </span>
                  <span className="ml-auto text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">
                    PLANET
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mt-1 leading-snug">
                  {t('wizard.planetBasemaps.description')}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setStep({ kind: 'planet-scenes' })}
                className="text-left px-4 py-3 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <IconStac className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                  <span className="text-sm font-medium text-neutral-900">
                    {t('wizard.planetDaily.title')}
                  </span>
                  <span className="ml-auto text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">
                    PLANET
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mt-1 leading-snug">
                  {t('wizard.planetDaily.description')}
                </p>
              </button>
            </div>
          </>
        )}

        {step.kind === 'custom-stac-question' && (
          <>
            <p className="text-xs text-neutral-600 leading-relaxed">
              {t('wizard.custom.question')}
            </p>
            <button
              type="button"
              onClick={() => setStep({ kind: 'custom-stac-browse' })}
              className="w-full text-left px-4 py-3.5 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
            >
              <span className="text-sm font-medium text-neutral-900 flex items-center gap-1.5">
                <IconStac className="w-3.5 h-3.5 text-brand-600" />
                {t('wizard.custom.stacOption')}
              </span>
              <p className="text-xs text-neutral-500 mt-1 leading-snug">
                <Trans
                  t={t}
                  i18nKey="wizard.custom.stacDescription"
                  components={{
                    strong: <strong />,
                    code: <code className="font-mono text-[11px]" />,
                  }}
                />
              </p>
            </button>
            <button
              type="button"
              onClick={() => setStep({ kind: 'custom-xyz' })}
              className="w-full text-left px-4 py-3.5 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
            >
              <span className="text-sm font-medium text-neutral-900">
                {t('wizard.custom.xyzOption')}
              </span>
              <p className="text-xs text-neutral-500 mt-1 leading-snug">
                <Trans
                  t={t}
                  i18nKey="wizard.custom.xyzDescription"
                  values={{ placeholders: '{z}/{x}/{y}' }}
                  components={{ code: <code className="font-mono text-[11px]" /> }}
                />
              </p>
            </button>
          </>
        )}
      </div>
    </Modal>
  );
};

interface CustomXyzStepProps {
  projectId: number;
  onBack: () => void;
  onConfirm: (source: ImagerySource) => Promise<void>;
}

const CustomXyzStep = ({ projectId, onBack, onConfirm }: CustomXyzStepProps) => {
  const { t } = useTranslation('imagery');
  const [submitting, setSubmitting] = useState(false);
  const [source, setSource] = useState<ImagerySource>(() => {
    const s = emptySource();
    s.name = t('wizard.xyz.defaultName');
    s.visualizations = [{ name: 'Default' }];
    s.collections = [emptyManualCollection(['Default'])];
    return s;
  });

  const vizNames = source.visualizations.map((v) => v.name);

  const updateCollection = (id: string, patch: Partial<CollectionItem>) => {
    setSource((s) => ({
      ...s,
      collections: s.collections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const addCollection = () => {
    setSource((s) => ({
      ...s,
      collections: [...s.collections, emptyManualCollection(vizNames)],
    }));
  };

  const removeCollection = (id: string) => {
    setSource((s) => ({
      ...s,
      collections: s.collections.filter((c) => c.id !== id),
    }));
  };

  const ready =
    source.name.trim().length > 0 &&
    source.collections.length > 0 &&
    source.collections.every(
      (c) =>
        c.slices.length > 0 &&
        c.slices.every((sl) => (sl.vizUrls ?? []).some((v) => v.url.trim().length > 0))
    );

  return (
    <Modal
      title={t('wizard.xyz.title')}
      onClose={onBack}
      maxWidth="max-w-xl"
      footer={
        <div className="flex justify-between">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-neutral-600 hover:text-neutral-800 cursor-pointer"
          >
            {t('wizard.back')}
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={async () => {
              setSubmitting(true);
              try {
                await onConfirm(source);
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={!ready || submitting}
          >
            {submitting ? t('wizard.adding') : t('wizard.addSource')}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">
            {t('wizard.xyz.sourceName')}
          </label>
          <Input
            size="sm"
            type="text"
            value={source.name}
            onChange={(e) => setSource({ ...source, name: e.target.value })}
            placeholder={t('wizard.xyz.sourceNamePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-neutral-500 leading-snug">
              <Trans
                t={t}
                i18nKey="wizard.xyz.collectionsHint"
                components={{ strong: <strong /> }}
              />
            </p>
            <button
              type="button"
              onClick={addCollection}
              className="text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t('wizard.xyz.addCollection')}
            </button>
          </div>
          <div className="space-y-3">
            {source.collections.map((c) => (
              <CollectionEditor
                key={c.id}
                collection={c}
                projectId={projectId}
                vizNames={vizNames}
                onChange={(patch) => updateCollection(c.id, patch)}
                onRemove={() => removeCollection(c.id)}
                inModal
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
