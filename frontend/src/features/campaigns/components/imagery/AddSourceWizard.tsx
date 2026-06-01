import { useState } from 'react';
import { Modal } from '~/shared/ui/Modal';
import { IconStac, IconChevronRight } from '~/shared/ui/Icons';
import { CatalogBrowser, MPC_PRESETS } from './CatalogBrowser';
import type { CatalogBrowserPreset } from './CatalogBrowser';
import { CollectionEditor } from './CollectionEditor';
import type { CollectionItem, ImagerySource, NamedVizParams } from './types';
import { emptyManualCollection, emptySource } from './types';
import type { ImageryController } from './controller';

interface AddSourceWizardProps {
  controller: ImageryController;
  onClose: () => void;
  campaignBbox?: number[] | null;
}

type WizardStep =
  | { kind: 'pick-preset' }
  | { kind: 'configure-preset'; preset: CatalogBrowserPreset }
  | { kind: 'custom-stac-question' }
  | { kind: 'custom-stac-browse' }
  | { kind: 'custom-xyz' };

const PRESET_BLURBS: Record<string, string> = {
  'sentinel-2-l2a':
    'High-resolution optical imagery (10 m), worldwide, ~5-day refresh. Best general-purpose pick.',
  'landsat-c2-l2': 'Mid-resolution optical imagery (30 m), worldwide, ~16-day refresh.',
  'hls2-s30':
    'Harmonized Landsat Sentinel-2 product (S30 subset). Use both HLS tiles for denser revisit.',
  'hls2-l30':
    'Harmonized Landsat Sentinel-2 product (L30 subset). Use both HLS tiles for denser revisit.',
  naip: 'High-resolution aerial imagery for the United States. Limited to NAIP coverage.',
  'sentinel-1-grd':
    'Synthetic-aperture radar (SAR), worldwide, cloud-penetrating. Useful for change detection.',
  'cop-dem-glo-30': 'Global digital elevation model at 30 m resolution. Static (non-temporal).',
};

export const AddSourceWizard = ({
  controller,
  onClose,
  campaignBbox = null,
}: AddSourceWizardProps) => {
  const [step, setStep] = useState<WizardStep>({ kind: 'pick-preset' });

  const back = () => {
    if (step.kind === 'configure-preset' || step.kind === 'custom-stac-question') {
      setStep({ kind: 'pick-preset' });
    } else if (step.kind === 'custom-stac-browse' || step.kind === 'custom-xyz') {
      setStep({ kind: 'custom-stac-question' });
    }
  };

  const finalizeFromCatalog = async (collections: CollectionItem[], fallbackName: string) => {
    if (collections.length === 0) return;
    const first = collections[0];
    const vizNames: NamedVizParams[] | undefined =
      first.data.type === 'stac_browser' ? first.data.visualizations : undefined;

    const src = emptySource();
    src.name = fallbackName;
    if (vizNames && vizNames.length > 0) {
      src.visualizations = vizNames.map((v) => ({ name: v.name }));
    }
    src.collections = collections;

    await controller.addSource(src);
    onClose();
  };

  if (step.kind === 'configure-preset') {
    return (
      <CatalogBrowser
        preset={step.preset}
        initialMode="mosaic"
        campaignBbox={campaignBbox}
        onAdd={(cols) => finalizeFromCatalog(cols, step.preset.label)}
        onClose={back}
      />
    );
  }

  if (step.kind === 'custom-stac-browse') {
    return (
      <CatalogBrowser
        initialMode="mosaic"
        campaignBbox={campaignBbox}
        onAdd={(cols) => {
          const fallback =
            cols[0]?.data.type === 'stac_browser'
              ? cols[0].data.stacCollectionId
              : 'Custom imagery';
          finalizeFromCatalog(cols, fallback);
        }}
        onClose={back}
      />
    );
  }

  if (step.kind === 'custom-xyz') {
    return (
      <CustomXyzStep
        onBack={back}
        onConfirm={async (source) => {
          await controller.addSource(source);
          onClose();
        }}
      />
    );
  }

  const title = step.kind === 'pick-preset' ? 'Add Imagery Source' : 'Custom imagery source';

  return (
    <Modal title={title} onClose={onClose} maxWidth="max-w-xl">
      <div className="p-4 space-y-3">
        {step.kind !== 'pick-preset' && (
          <button
            type="button"
            onClick={back}
            className="text-xs text-neutral-500 hover:text-neutral-700 cursor-pointer"
          >
            ← Back
          </button>
        )}

        {step.kind === 'pick-preset' && (
          <>
            <p className="text-xs text-neutral-500">
              Pick an imagery dataset to add. We&apos;ll guide you through the rest.
            </p>
            <div className="grid gap-1.5">
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
                    {PRESET_BLURBS[preset.stacCollectionId] ?? ''}
                  </p>
                  <p className="text-[10px] text-neutral-400 mt-0.5 font-mono">
                    {preset.stacCollectionId}
                  </p>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStep({ kind: 'custom-stac-question' })}
                className="text-left px-4 py-3 rounded-lg border border-dashed border-neutral-300 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <IconChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                  <span className="text-sm font-medium text-neutral-900">Custom (other)</span>
                </div>
                <p className="text-xs text-neutral-500 mt-1 leading-snug">
                  Bring your own STAC catalog or raw XYZ tile URLs.
                </p>
              </button>
            </div>
          </>
        )}

        {step.kind === 'custom-stac-question' && (
          <>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Where does your imagery come from? Pick the option that matches your data provider.
            </p>
            <button
              type="button"
              onClick={() => setStep({ kind: 'custom-stac-browse' })}
              className="w-full text-left px-4 py-3.5 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
            >
              <span className="text-sm font-medium text-neutral-900 flex items-center gap-1.5">
                <IconStac className="w-3.5 h-3.5 text-brand-600" />
                Yes - my imagery is in a STAC catalog
              </span>
              <p className="text-xs text-neutral-500 mt-1 leading-snug">
                <strong>STAC</strong> (SpatioTemporal Asset Catalog) is a standard for organizing
                geospatial data. Public examples: USGS Landsat catalog, NASA EarthData, Element 84
                Earth Search. If your data provider gives you a STAC API URL ending in{' '}
                <code className="font-mono text-[11px]">/v1</code> or similar, choose this.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setStep({ kind: 'custom-xyz' })}
              className="w-full text-left px-4 py-3.5 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
            >
              <span className="text-sm font-medium text-neutral-900">
                No - I have raw XYZ tile URLs
              </span>
              <p className="text-xs text-neutral-500 mt-1 leading-snug">
                Use this if you have a tile server URL with{' '}
                <code className="font-mono text-[11px]">{'{z}/{x}/{y}'}</code> placeholders, e.g. a
                Mapbox/MapTiler endpoint or a pre-generated mosaic URL.
              </p>
            </button>
          </>
        )}
      </div>
    </Modal>
  );
};

interface CustomXyzStepProps {
  onBack: () => void;
  onConfirm: (source: ImagerySource) => Promise<void>;
}

const CustomXyzStep = ({ onBack, onConfirm }: CustomXyzStepProps) => {
  const [submitting, setSubmitting] = useState(false);
  const [source, setSource] = useState<ImagerySource>(() => {
    const s = emptySource();
    s.name = 'Custom XYZ';
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
      title="Add custom XYZ source"
      onClose={onBack}
      maxWidth="max-w-xl"
      scrollable
      footer={
        <div className="flex justify-between">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-neutral-600 hover:text-neutral-800 cursor-pointer"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={async () => {
              setSubmitting(true);
              try {
                await onConfirm(source);
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={!ready || submitting}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors cursor-pointer disabled:bg-neutral-300 disabled:text-neutral-500 disabled:cursor-not-allowed"
          >
            {submitting ? 'Adding…' : 'Add source'}
          </button>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-700 font-medium">Source name</label>
          <input
            type="text"
            value={source.name}
            onChange={(e) => setSource({ ...source, name: e.target.value })}
            placeholder="e.g. Internal MapTiler basemap"
            className="w-full border border-neutral-300 rounded-md px-2.5 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-neutral-500 leading-snug">
              A source can hold one or more <strong>collections</strong>, each covering its own time
              window. Most XYZ setups need just one - but you can add more (e.g. one per year).
            </p>
            <button
              type="button"
              onClick={addCollection}
              className="text-xs text-brand-700 hover:text-brand-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              + Add collection
            </button>
          </div>
          <div className="space-y-3">
            {source.collections.map((c) => (
              <CollectionEditor
                key={c.id}
                collection={c}
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
