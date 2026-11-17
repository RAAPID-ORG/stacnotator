import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  listPlanetSeries,
  listPlanetSeriesMosaics,
  type PlanetCredentials,
  type PlanetSeriesMosaicsOut,
  type PlanetSeriesOut,
} from '~/api/client';
import { Modal } from '~/shared/ui/Modal';
import { Button, DateField, Input, Select } from '~/shared/ui/forms';
import { SegmentedControl } from '~/shared/ui/SegmentedControl';
import i18n from '~/shared/i18n';
import { handleError } from '~/shared/utils/errorHandler';
import { PlanetKeyConnect } from './PlanetKeyConnect';
import {
  COLLECTION_PERIODS,
  defaultMosaicRange,
  generatePlanetCollections,
  sharedRenderings,
} from './planetGeneration';
import type { CollectionPeriod } from './planetGeneration';
import { emptySource } from './types';
import type { ImagerySource } from './types';
import { PlanPreview } from './PlanPreview';
import { WizardSteps } from './WizardSteps';

interface PlanetBrowserProps {
  projectId: number;
  onAdd: (source: ImagerySource) => Promise<void>;
  onClose: () => void;
}

/** Whether a window's cover is one of its own mosaics or another series' mosaic. */
type CoverFrom = 'own' | 'series';

const shallowerZoom = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null ? Math.min(a, b) : (a ?? b ?? null);

const PERIOD_LABELS = {
  month: 'planet.periods.month',
  quarter: 'planet.periods.quarter',
  year: 'planet.periods.year',
  all: 'planet.periods.all',
} as const satisfies Record<CollectionPeriod, string>;

/**
 * Build an imagery source from a Planet basemap series.
 *
 * Planet publishes its temporal structure through series rather than STAC, and serves
 * the mosaics as finished XYZ tiles - so this browses the series, then writes ordinary
 * manual collections. Nothing is searched, registered or rendered on a tiler.
 */
export const PlanetBrowser = ({ projectId, onAdd, onClose }: PlanetBrowserProps) => {
  const { t } = useTranslation('imagery');
  /** The key the browse calls spend. */
  const [credentials, setCredentials] = useState<PlanetCredentials | null>(null);
  const [series, setSeries] = useState<PlanetSeriesOut[] | null>(null);
  const [chosen, setChosen] = useState<PlanetSeriesOut | null>(null);
  const [details, setDetails] = useState<PlanetSeriesMosaicsOut | null>(null);
  const [coverFrom, setCoverFrom] = useState<CoverFrom>('own');
  /** The series whose mosaics are the windows and their covers, if any. */
  const [coverSeries, setCoverSeries] = useState<PlanetSeriesOut | null>(null);
  const [coverDetails, setCoverDetails] = useState<PlanetSeriesMosaicsOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [period, setPeriod] = useState<CollectionPeriod>('year');
  const [coverNth, setCoverNth] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [renderings, setRenderings] = useState<string[]>([]);

  useEffect(() => {
    if (!credentials) return;
    setLoading(true);
    setSeries(null);
    void listPlanetSeries({ body: credentials })
      .then(({ data }) => setSeries(data ?? []))
      .catch((err) => {
        setSeries([]);
        handleError(err, i18n.t('imagery:planet.errors.listSeries'));
      })
      .finally(() => setLoading(false));
  }, [credentials]);

  useEffect(() => {
    if (!chosen || !credentials) return;
    setLoading(true);
    setDetails(null);
    void listPlanetSeriesMosaics({
      path: { series_id: chosen.id },
      body: credentials,
    })
      .then(({ data }) => {
        if (!data) return;
        setDetails(data);
        setRenderings(data.renderings);
        const range = defaultMosaicRange(data.mosaics);
        setStartDate(range.startDate);
        setEndDate(range.endDate);
      })
      .catch((err) => handleError(err, i18n.t('imagery:planet.errors.listMosaics')))
      .finally(() => setLoading(false));
  }, [chosen, credentials]);

  useEffect(() => {
    if (!coverSeries || !credentials) {
      setCoverDetails(null);
      return;
    }
    void listPlanetSeriesMosaics({
      path: { series_id: coverSeries.id },
      body: credentials,
    })
      .then(({ data }) => {
        if (!data) return;
        setCoverDetails(data);
        // A rendering the cover cannot serve would throw the moment an
        // annotator selected it, so it stops being on offer here.
        setRenderings((current) => sharedRenderings(current, data.renderings));
      })
      .catch((err) => {
        setCoverSeries(null);
        handleError(err, i18n.t('imagery:planet.errors.listCoverMosaics'));
      });
  }, [coverSeries, credentials]);

  const backToSeries = () => {
    setChosen(null);
    setDetails(null);
    setCoverFrom('own');
    setCoverSeries(null);
  };

  /** Any change to the key drops what the previous one found. */
  const reset = () => {
    setSeries(null);
    backToSeries();
  };

  const { collections, orphans } = useMemo(() => {
    // Until a cover series is chosen and its mosaics have arrived, this would
    // otherwise preview windows without the cover that was asked for.
    if (!details || !chosen || !startDate || !endDate || (coverFrom === 'series' && !coverDetails))
      return { collections: [], orphans: [] };
    return generatePlanetCollections(details.mosaics, {
      seriesName: chosen.name,
      startDate,
      endDate,
      collectionPeriod: period,
      coverNth,
      renderings,
      coverMosaics: coverDetails?.mosaics,
    });
  }, [details, chosen, startDate, endDate, period, coverNth, renderings, coverFrom, coverDetails]);

  const sliceTotal = collections.reduce((n, c) => n + c.slices.length, 0);
  const unavailable = details?.mosaics.filter((m) => m.unavailable_reason) ?? [];
  // Only what both series can render: the cover slice has to answer for every
  // visualization the source offers.
  const availableRenderings = coverDetails
    ? sharedRenderings(details?.renderings ?? [], coverDetails.renderings)
    : (details?.renderings ?? []);
  const unshared = (details?.renderings ?? []).filter((n) => !availableRenderings.includes(n));

  const add = async () => {
    if (!chosen || !details || !credentials || collections.length === 0) return;
    setSubmitting(true);
    try {
      const source = emptySource();
      source.name = chosen.name;
      source.visualizations = renderings.map((name) => ({ name }));
      source.collections = collections;
      // One cap for the whole source, so it has to be the shallower of the two:
      // asking Planet for tiles past a series' native zoom leaves that series
      // blank. Same-resolution products (the usual case) are unaffected.
      source.maxNativeZoom = shallowerZoom(details.max_native_zoom, coverDetails?.max_native_zoom);
      // The source keeps whichever key browsed it, so its tiles load straight away.
      source.organizationApiKeyId = credentials.organization_api_key_id ?? null;
      source.apiKey = credentials.api_key ?? undefined;
      await onAdd(source);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRendering = (name: string) =>
    setRenderings((current) =>
      current.includes(name) ? current.filter((n) => n !== name) : [...current, name]
    );

  return (
    <Modal
      title={t('planet.title')}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <PlanPreview
          rows={collections.map((collection) => ({
            key: collection.id,
            label: collection.name,
            slices: collection.slices
              .slice(collection.hasDedicatedCover ? 1 : 0)
              .map((slice) => slice.name),
            cover: collection.hasDedicatedCover
              ? t('planet.coverMosaic', {
                  name: coverSeries?.name,
                  start: collection.slices[0].startDate,
                  end: collection.slices[0].endDate,
                })
              : (collection.slices[collection.coverSliceIndex]?.name ?? ''),
          }))}
          summary={t(coverSeries ? 'planet.summaryWithCover' : 'planet.summary', {
            windows: t('planet.windows', { count: collections.length }),
            slices: t('planet.slices', { count: sliceTotal }),
          })}
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => void add()}
              disabled={submitting || collections.length === 0 || renderings.length === 0}
            >
              {submitting ? t('wizard.adding') : t('wizard.addSource')}
            </Button>
          }
        />
      }
    >
      <div className="p-4 space-y-4">
        <WizardSteps
          steps={[
            { label: t('planet.steps.series'), onClick: chosen ? backToSeries : undefined },
            { label: t('catalog.steps.configure') },
          ]}
          current={chosen ? 1 : 0}
          onBack={chosen ? backToSeries : onClose}
        />

        <PlanetKeyConnect
          projectId={projectId}
          onChange={(next) => {
            reset();
            setCredentials(next);
          }}
        />

        {loading && <p className="text-[11px] text-neutral-500">{t('planet.asking')}</p>}

        {series && !chosen && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-neutral-500 leading-snug">
              <Trans t={t} i18nKey="planet.seriesHint" components={{ strong: <strong /> }} />
            </p>
            <p className="text-[11px] text-amber-700 leading-snug rounded-md bg-amber-50 border border-amber-200 p-2">
              {t('planet.globalWarning')}
            </p>
            {series.length === 0 && !loading && (
              <p className="text-[11px] text-amber-700">{t('planet.noSeries')}</p>
            )}
            <div className="grid gap-1.5">
              {series.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setChosen(s)}
                  className="text-left px-4 py-2.5 rounded-lg border border-neutral-200 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-colors"
                >
                  <span className="text-sm font-medium text-neutral-900">{s.name}</span>
                  {s.description && (
                    <p className="text-xs text-neutral-500 mt-0.5 leading-snug">{s.description}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {chosen && details && (
          <div className="space-y-3">
            <p className="text-xs text-neutral-700 font-semibold">{chosen.name}</p>

            <p className="text-[11px] text-neutral-500 leading-snug">
              <Trans t={t} i18nKey="planet.windowsIntro" components={{ strong: <strong /> }} />
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-neutral-700 font-medium">{t('planet.from')}</label>
                <DateField
                  size="sm"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-700 font-medium">{t('planet.to')}</label>
                <DateField size="sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">
                {t('planet.groupIntoWindows')}
              </label>
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
                <span>
                  <Trans
                    t={t}
                    i18nKey="planet.groupSentence"
                    values={{ name: chosen.name }}
                    components={{ strong: <strong /> }}
                  />
                </span>
                {coverFrom === 'own' ? (
                  <Select
                    size="sm"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as CollectionPeriod)}
                    aria-label={t('planet.groupIntoWindows')}
                    className="!w-auto"
                  >
                    {COLLECTION_PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {t(PERIOD_LABELS[p])}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span>
                    <Trans
                      t={t}
                      i18nKey={
                        coverSeries ? 'planet.windowPerCoverMosaic' : 'planet.windowPerCoverPending'
                      }
                      values={{ name: coverSeries?.name }}
                      components={{ strong: <strong /> }}
                    />
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-neutral-700 font-medium">{t('bulk.coverSlice')}</label>
              <p className="text-[11px] text-neutral-500 leading-snug">{t('planet.coverHelp')}</p>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] text-neutral-600 leading-snug">
                <p className="font-medium text-neutral-700">{t('planet.example.title')}</p>
                <ul className="mt-1 space-y-0.5 list-disc pl-4">
                  <li>{t('planet.example.yearlyCoverSeries')}</li>
                  <li>{t('planet.example.yearlyCoverNth')}</li>
                  <li>{t('planet.example.monthly')}</li>
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl<CoverFrom>
                  segments={[
                    { value: 'own', label: t('planet.coverFromOwn') },
                    { value: 'series', label: t('planet.coverFromSeries') },
                  ]}
                  value={coverFrom}
                  onChange={(next) => {
                    setCoverFrom(next);
                    if (next === 'own' && coverSeries) {
                      setCoverSeries(null);
                      // Dropping the cover puts the renderings it could not serve
                      // back on offer, so they are checked again too.
                      setRenderings(details.renderings);
                    }
                  }}
                  aria-label={t('bulk.coverSlice')}
                />
                {coverFrom === 'own' && (
                  <label className="flex items-center gap-2 text-xs text-neutral-700 font-medium">
                    {t('planet.coverNth')}
                    <Input
                      size="sm"
                      type="number"
                      min={1}
                      value={coverNth}
                      onChange={(e) => setCoverNth(Math.max(1, Number(e.target.value) || 1))}
                      className="!w-20"
                    />
                  </label>
                )}
                {coverFrom === 'series' && (
                  <Select
                    size="sm"
                    value={coverSeries?.id ?? ''}
                    onChange={(e) =>
                      setCoverSeries(
                        (series ?? []).find((candidate) => candidate.id === e.target.value) ?? null
                      )
                    }
                    aria-label={t('planet.coverSeries')}
                    className="!w-auto"
                  >
                    <option value="" disabled>
                      {t('planet.chooseCoverSeries')}
                    </option>
                    {(series ?? [])
                      .filter((candidate) => candidate.id !== chosen.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </Select>
                )}
              </div>
              {coverFrom === 'own' && (
                <p className="text-[11px] text-neutral-500 leading-snug">
                  {t('planet.coverNthHelp')}
                </p>
              )}
              {coverFrom === 'series' && (
                <p className="text-[11px] text-neutral-500 leading-snug">
                  {t('planet.coverSeriesHelp')}
                </p>
              )}
            </div>

            {orphans.length > 0 && (
              <div className="space-y-1 rounded-md bg-amber-50 border border-amber-200 p-2">
                <p className="text-[11px] text-amber-800 font-medium">
                  {t('planet.orphans', { count: orphans.length, name: coverSeries?.name })}
                </p>
                <ul className="text-[11px] text-amber-700 space-y-0.5">
                  {orphans.slice(0, 5).map((m) => (
                    <li key={m.id}>
                      {t('planet.dateRange', { start: m.first_acquired, end: m.last_acquired })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">
                {t('planet.visualizations')}
              </label>
              <p className="text-[11px] text-neutral-500 leading-snug">
                {details.renderings.length > 1
                  ? t('planet.analyticSeries')
                  : t('planet.visualSeries')}
              </p>
              <div className="flex flex-wrap gap-3 pt-0.5">
                {availableRenderings.map((name) => (
                  <label key={name} className="flex items-center gap-1.5 text-xs text-neutral-700">
                    <input
                      type="checkbox"
                      checked={renderings.includes(name)}
                      onChange={() => toggleRendering(name)}
                    />
                    {name}
                  </label>
                ))}
                {unshared.map((name) => (
                  <label
                    key={name}
                    className="flex items-center gap-1.5 text-xs text-neutral-400"
                    title={t('planet.unsharedRendering', { name: coverSeries?.name })}
                  >
                    <input type="checkbox" disabled checked={false} readOnly />
                    {name}
                  </label>
                ))}
              </div>
            </div>

            {unavailable.length > 0 && (
              <div className="space-y-1 rounded-md bg-amber-50 border border-amber-200 p-2">
                <p className="text-[11px] text-amber-800 font-medium">
                  {t('planet.unavailable', { count: unavailable.length })}
                </p>
                <ul className="text-[11px] text-amber-700 space-y-0.5">
                  {unavailable.slice(0, 5).map((m) => (
                    <li key={m.id}>
                      {m.name || m.first_acquired} - {m.unavailable_reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
