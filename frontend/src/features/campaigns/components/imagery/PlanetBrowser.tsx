import { useEffect, useMemo, useState } from 'react';
import {
  listPlanetSeries,
  listPlanetSeriesMosaics,
  type PlanetCredentials,
  type PlanetSeriesMosaicsOut,
  type PlanetSeriesOut,
} from '~/api/client';
import { Modal } from '~/shared/ui/Modal';
import { Button, DateField, Input, Select } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';
import { PlanetKeyConnect } from './PlanetKeyConnect';
import {
  COLLECTION_PERIODS,
  defaultMosaicRange,
  generatePlanetCollections,
  sharedRenderings,
  usableMosaics,
} from './planetGeneration';
import type { CollectionPeriod } from './planetGeneration';
import { emptySource } from './types';
import type { ImagerySource } from './types';

interface PlanetBrowserProps {
  projectId: number;
  onAdd: (source: ImagerySource) => Promise<void>;
  onClose: () => void;
}

const NO_COVER = 'none';

const shallowerZoom = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null ? Math.min(a, b) : (a ?? b ?? null);

const PERIOD_LABELS: Record<CollectionPeriod, string> = {
  month: 'One window per month',
  quarter: 'One window per quarter',
  year: 'One window per year',
  all: 'A single window for the whole series',
};

/**
 * Build an imagery source from a Planet basemap series.
 *
 * Planet publishes its temporal structure through series rather than STAC, and serves
 * the mosaics as finished XYZ tiles - so this browses the series, then writes ordinary
 * manual collections. Nothing is searched, registered or rendered on a tiler.
 */
export const PlanetBrowser = ({ projectId, onAdd, onClose }: PlanetBrowserProps) => {
  /** The key the browse calls spend. */
  const [credentials, setCredentials] = useState<PlanetCredentials | null>(null);
  const [series, setSeries] = useState<PlanetSeriesOut[] | null>(null);
  const [chosen, setChosen] = useState<PlanetSeriesOut | null>(null);
  const [details, setDetails] = useState<PlanetSeriesMosaicsOut | null>(null);
  /** The coarser series standing in as each window's cover, if any. */
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
        handleError(err, 'Could not list Planet basemap series');
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
      .catch((err) => handleError(err, 'Could not list the mosaics in this series'))
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
        handleError(err, 'Could not list the mosaics in the cover series');
      });
  }, [coverSeries, credentials]);

  /** Any change to the key drops what the previous one found. */
  const reset = () => {
    setSeries(null);
    setChosen(null);
    setDetails(null);
    setCoverSeries(null);
  };

  const { collections, orphans } = useMemo(() => {
    // A chosen cover series whose mosaics are still in flight would otherwise
    // preview as calendar grouping for a moment, which is not what was asked for.
    if (!details || !chosen || !startDate || !endDate || (coverSeries && !coverDetails))
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
  }, [
    details,
    chosen,
    startDate,
    endDate,
    period,
    coverNth,
    renderings,
    coverSeries,
    coverDetails,
  ]);

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
      title="Add Planet basemaps"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">
            {collections.length > 0
              ? `${collections.length} window${collections.length === 1 ? '' : 's'}, ${sliceTotal} slice${sliceTotal === 1 ? '' : 's'}${coverSeries ? ' (cover included)' : ''}`
              : ''}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void add()}
            disabled={submitting || collections.length === 0 || renderings.length === 0}
          >
            {submitting ? 'Adding…' : 'Add source'}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <PlanetKeyConnect
          projectId={projectId}
          onChange={(next) => {
            reset();
            setCredentials(next);
          }}
        />

        {loading && <p className="text-[11px] text-neutral-500">Asking Planet…</p>}

        {series && !chosen && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-neutral-500 leading-snug">
              A <strong>series</strong> is a cadence of basemaps - each of its mosaics becomes one
              slice, so the whole time range arrives at once.
            </p>
            <p className="text-[11px] text-amber-700 leading-snug rounded-md bg-amber-50 border border-amber-200 p-2">
              Only the global series cover the whole world. All other Planet imagery may be blank
              over your campaign&apos;s region!
            </p>
            {series.length === 0 && !loading && (
              <p className="text-[11px] text-amber-700">This key can see no basemap series.</p>
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
            <button
              type="button"
              onClick={() => {
                setChosen(null);
                setDetails(null);
                setCoverSeries(null);
              }}
              className="text-xs text-neutral-500 hover:text-neutral-700 cursor-pointer"
            >
              ← Back to series
            </button>

            <p className="text-xs text-neutral-700">
              <strong>{chosen.name}</strong> - {usableMosaics(details.mosaics).length} mosaics
              {details.max_native_zoom != null && `, sharp to zoom ${details.max_native_zoom}`}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-neutral-700 font-medium">From</label>
                <DateField
                  size="sm"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-700 font-medium">To</label>
                <DateField size="sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">Cover slice</label>
              <p className="text-[11px] text-neutral-500 leading-snug">
                Planet does not composite on request, so a coarser series stands in: each of its
                mosaics becomes one window, shown first, with this series&apos; mosaics inside its
                span as the detail underneath.
              </p>
              <Select
                size="sm"
                value={coverSeries?.id ?? NO_COVER}
                onChange={(e) => {
                  const next =
                    (series ?? []).find((candidate) => candidate.id === e.target.value) ?? null;
                  setCoverSeries(next);
                  // Dropping the cover puts the renderings it could not serve
                  // back on offer, so they are checked again too.
                  if (!next) setRenderings(details.renderings);
                }}
                aria-label="Cover series"
              >
                <option value={NO_COVER}>No cover series - windows by calendar period</option>
                {(series ?? [])
                  .filter((candidate) => candidate.id !== chosen.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </Select>
            </div>

            {!coverSeries && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-neutral-700 font-medium">Group into windows</label>
                  <Select
                    size="sm"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as CollectionPeriod)}
                    aria-label="Group into windows"
                  >
                    {COLLECTION_PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {PERIOD_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-neutral-700 font-medium">
                    Show the {coverNth === 1 ? 'first' : `${coverNth}.`} slice of each window first
                  </label>
                  <Input
                    size="sm"
                    type="number"
                    min={1}
                    value={coverNth}
                    onChange={(e) => setCoverNth(Math.max(1, Number(e.target.value) || 1))}
                    className="!w-24"
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">Visualizations</label>
              <p className="text-[11px] text-neutral-500 leading-snug">
                {details.renderings.length > 1
                  ? 'This is an analytic series, so Planet can render its bands more than one way.'
                  : 'This series is served as finished colour imagery, so it has one rendering.'}
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
                    title={`${coverSeries?.name} does not offer this rendering, so it has no cover slice`}
                  >
                    <input type="checkbox" disabled checked={false} readOnly />
                    {name}
                  </label>
                ))}
              </div>
            </div>

            {orphans.length > 0 && (
              <div className="space-y-1 rounded-md bg-amber-50 border border-amber-200 p-2">
                <p className="text-[11px] text-amber-800 font-medium">
                  {orphans.length} mosaic{orphans.length === 1 ? '' : 's'} fall outside every{' '}
                  {coverSeries?.name} window and are left out:
                </p>
                <ul className="text-[11px] text-amber-700 space-y-0.5">
                  {orphans.slice(0, 5).map((m) => (
                    <li key={m.id}>
                      {m.first_acquired} to {m.last_acquired}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {unavailable.length > 0 && (
              <div className="space-y-1 rounded-md bg-amber-50 border border-amber-200 p-2">
                <p className="text-[11px] text-amber-800 font-medium">
                  {unavailable.length} mosaic{unavailable.length === 1 ? '' : 's'} in this series
                  cannot be used:
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
