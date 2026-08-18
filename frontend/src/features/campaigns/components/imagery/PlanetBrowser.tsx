import { useEffect, useMemo, useState } from 'react';
import {
  getProjectOrganizationKeys,
  listPlanetSeries,
  listPlanetSeriesMosaics,
  type OrganizationApiKeyOut,
  type PlanetCredentials,
  type PlanetSeriesMosaicsOut,
  type PlanetSeriesOut,
} from '~/api/client';
import { Modal } from '~/shared/ui/Modal';
import { Button, Input, Select } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';
import { ReadOnlyKeyConsent } from '~/shared/ui/ReadOnlyKeyConsent';
import { COLLECTION_PERIODS, generatePlanetCollections, usableMosaics } from './planetGeneration';
import type { CollectionPeriod } from './planetGeneration';
import { emptySource } from './types';
import type { ImagerySource } from './types';

interface PlanetBrowserProps {
  projectId: number;
  onAdd: (source: ImagerySource) => Promise<void>;
  onClose: () => void;
}

const OWN_KEY = 'own';

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
  const [keys, setKeys] = useState<OrganizationApiKeyOut[] | null>(null);
  const [keyId, setKeyId] = useState<number | null>(null);
  const [ownKey, setOwnKey] = useState('');
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);
  /** The credential the browse calls are currently allowed to use, set by "Connect"
   *  rather than by typing, so every keystroke does not fire a request at Planet. */
  const [credentials, setCredentials] = useState<PlanetCredentials | null>(null);
  const [series, setSeries] = useState<PlanetSeriesOut[] | null>(null);
  const [chosen, setChosen] = useState<PlanetSeriesOut | null>(null);
  const [details, setDetails] = useState<PlanetSeriesMosaicsOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [period, setPeriod] = useState<CollectionPeriod>('year');
  const [coverNth, setCoverNth] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [renderings, setRenderings] = useState<string[]>([]);

  useEffect(() => {
    void getProjectOrganizationKeys({ path: { project_id: projectId } })
      .then(({ data }) => {
        const items = data?.items ?? [];
        setKeys(items);
        // A shared key is the better default when the organization has one.
        setKeyId(items[0]?.id ?? null);
      })
      .catch((err) => {
        setKeys([]);
        handleError(err, 'Failed to load organization keys', { showUser: false });
      });
  }, [projectId]);

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
        const usable = usableMosaics(data.mosaics);
        setStartDate(usable[0]?.first_acquired ?? '');
        setEndDate(usable[usable.length - 1]?.first_acquired ?? '');
      })
      .catch((err) => handleError(err, 'Could not list the mosaics in this series'))
      .finally(() => setLoading(false));
  }, [chosen, credentials]);

  /** Any change to the key drops what the previous one found. */
  const reset = () => {
    setCredentials(null);
    setSeries(null);
    setChosen(null);
    setDetails(null);
  };

  const canConnect = keyId !== null || (ownKey.trim().length > 0 && readOnlyConfirmed);

  const connect = () =>
    setCredentials(
      keyId !== null
        ? { project_id: projectId, organization_api_key_id: keyId }
        : { project_id: projectId, api_key: ownKey.trim() }
    );

  const collections = useMemo(() => {
    if (!details || !chosen || !startDate || !endDate) return [];
    return generatePlanetCollections(details.mosaics, {
      seriesName: chosen.name,
      startDate,
      endDate,
      collectionPeriod: period,
      coverNth,
      renderings,
    });
  }, [details, chosen, startDate, endDate, period, coverNth, renderings]);

  const sliceTotal = collections.reduce((n, c) => n + c.slices.length, 0);
  const unavailable = details?.mosaics.filter((m) => m.unavailable_reason) ?? [];

  const add = async () => {
    if (!chosen || !details || !credentials || collections.length === 0) return;
    setSubmitting(true);
    try {
      const source = emptySource();
      source.name = chosen.name;
      source.visualizations = renderings.map((name) => ({ name }));
      source.collections = collections;
      source.maxNativeZoom = details.max_native_zoom;
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
      scrollable
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">
            {collections.length > 0
              ? `${collections.length} window${collections.length === 1 ? '' : 's'}, ${sliceTotal} slice${sliceTotal === 1 ? '' : 's'}`
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
        <div className="space-y-1.5">
          <label className="text-xs text-neutral-700 font-medium">Planet API key</label>
          <p className="text-[11px] text-neutral-500 leading-snug">
            Use one of your organization&apos;s shared keys, or provide a key for this campaign. The
            key is encrypted on the server and used only to fetch tiles on each annotator&apos;s
            behalf - it never reaches their browser.
          </p>
          <Select
            size="sm"
            value={keyId === null ? OWN_KEY : String(keyId)}
            onChange={(e) => {
              setKeyId(e.target.value === OWN_KEY ? null : Number(e.target.value));
              reset();
            }}
            aria-label="Planet key source"
          >
            {(keys ?? []).map((key) => (
              <option key={key.id} value={key.id}>
                {key.name} (organization)
              </option>
            ))}
            <option value={OWN_KEY}>Enter a key for this campaign</option>
          </Select>

          {keyId === null && (
            <>
              <Input
                size="sm"
                type="password"
                value={ownKey}
                onChange={(e) => {
                  setOwnKey(e.target.value);
                  reset();
                }}
                placeholder="Paste your Planet API key"
                autoComplete="off"
                className="text-[11px] font-mono"
              />
              <ReadOnlyKeyConsent confirmed={readOnlyConfirmed} onChange={setReadOnlyConfirmed} />
            </>
          )}

          {!credentials && (
            <Button variant="secondary" size="sm" onClick={connect} disabled={!canConnect}>
              Connect to Planet
            </Button>
          )}
        </div>

        {loading && <p className="text-[11px] text-neutral-500">Asking Planet…</p>}

        {series && !chosen && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-neutral-500 leading-snug">
              A <strong>series</strong> is a cadence of basemaps - each of its mosaics becomes one
              slice, so the whole time range arrives at once.
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
                <Input
                  size="sm"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-700 font-medium">To</label>
                <Input
                  size="sm"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

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

            <div className="space-y-1">
              <label className="text-xs text-neutral-700 font-medium">Visualizations</label>
              <p className="text-[11px] text-neutral-500 leading-snug">
                {details.renderings.length > 1
                  ? 'This is an analytic series, so Planet can render its bands more than one way.'
                  : 'This series is served as finished colour imagery, so it has one rendering.'}
              </p>
              <div className="flex flex-wrap gap-3 pt-0.5">
                {details.renderings.map((name) => (
                  <label key={name} className="flex items-center gap-1.5 text-xs text-neutral-700">
                    <input
                      type="checkbox"
                      checked={renderings.includes(name)}
                      onChange={() => toggleRendering(name)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </div>

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
