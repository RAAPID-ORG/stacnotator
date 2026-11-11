import { useCampaign, useCampaignStore } from '../../stores/campaign';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimeseriesWindow } from '../../campaign/timeseries';
import { Spinner } from '~/shared/ui/Spinner';
import {
  locationKey,
  probeLocation,
  type Probe,
  type TimeseriesLocation,
} from '../../campaign/probes';
import { useWorkStore } from '../../stores/work';
import { useMapFocus } from '../../stores/tasks';
import { Chart, type ChartPoint } from './TimeseriesChart';
import { timeSeriesCache, type TimeSeriesData } from './cache';
import { extractErrorMessage, handleError } from '~/shared/utils/errorHandler';

export interface TimeseriesPanelProps {
  window: TimeseriesWindow;
}

/**
 * The locations this chart compares: in Tasks the task's own point first, then
 * every probe; in Explore the probes alone. `isProbe` drives the marker colour
 * the chart matches, so the base location keeps the plain series palette.
 *
 * A probe's suffix is its number alone: the legend repeats every series name
 * once per probe, and spelling out "(probe 2)" each time crowded it out.
 */
function chartPoints(taskLocation: TimeseriesLocation | null, probes: Probe[]): ChartPoint[] {
  const points: ChartPoint[] = taskLocation
    ? [{ key: locationKey(taskLocation), location: taskLocation, label: '', probeIndex: null }]
    : [];
  probes.forEach((probe, index) => {
    const location = probeLocation(probe);
    points.push({
      key: locationKey(location),
      location,
      label: ` ${index + 1}`,
      probeIndex: index,
    });
  });
  return points;
}

export function TimeseriesPanel({ window: tsWindow }: TimeseriesPanelProps) {
  const { t } = useTranslation('panels');
  const mode = useCampaignStore((s) => s.workMode);
  // Panel composition rebuilds the window (and with it this array) whenever
  // the page recomposes, e.g. on every collection change. Keying on the
  // series' contents instead keeps the fetch and the chart's datasets put.
  const seriesKey = tsWindow.series.map((ts) => `${ts.id}:${ts.name}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const series = useMemo(() => tsWindow.series, [seriesKey]);
  const ids = useMemo(() => series.map((ts) => ts.id), [series]);
  const campaignId = useCampaign().id;
  const isExplore = mode === 'explore';

  const focus = useMapFocus();
  const probes = useWorkStore((s) => s.probes);
  const points = useMemo(
    () => chartPoints(isExplore ? null : (focus?.timeseriesLocation ?? null), probes),
    [isExplore, focus?.timeseriesLocation, probes]
  );
  const pointsKey = points.map((p) => p.key).join('|');

  // Stable identity: the prefetch effect keys on this array, and mapFocus only
  // publishes a new `upcoming` when the points themselves change.
  const upcoming = isExplore ? undefined : focus?.upcomingTimeseriesLocations;

  const [data, setData] = useState<Record<string, TimeSeriesData>>({});
  const [loadingCount, setLoadingCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (points.length === 0 || ids.length === 0) {
      setData({});
      setLoadingCount(0);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoadingCount(points.length);
    setError(null);

    for (const point of points) {
      timeSeriesCache
        .get(campaignId, ids, point.location)
        .then((result) => {
          if (cancelled || !result) return;
          setData((prev) => ({ ...prev, [point.key]: result }));
        })
        .catch((err) => {
          handleError(err, 'Failed to load time series data', { showUser: false });
          if (!cancelled) setError(new Error(extractErrorMessage(err)));
        })
        .finally(() => {
          if (!cancelled) setLoadingCount((n) => n - 1);
        });
    }

    return () => {
      cancelled = true;
    };
    // Only re-fetch when the points (or the series list) actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, ids, pointsKey]);

  useEffect(() => {
    if (ids.length === 0 || !upcoming?.length) return;
    timeSeriesCache.prefetch(campaignId, ids, upcoming);
  }, [campaignId, ids, upcoming]);

  // Only what the chart is currently asked to draw, so a removed probe's rows
  // leave with it rather than lingering in the cache-shaped state.
  const loaded = useMemo(
    () => points.filter((p) => data[p.key]).map((p) => ({ point: p, data: data[p.key] })),
    [points, data]
  );

  const isLoading = loadingCount > 0;

  if (error && loaded.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <p role="alert" className="text-[10px] text-red-600">
            {t('timeseries.loadFailed')} {error.message}
          </p>
        </div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[10px] text-neutral-500">{t('timeseries.noLocation')}</p>
        </div>
      </div>
    );
  }

  // Show a full loading state only until the first point has data; later
  // points fade the existing chart instead (opacity below) so the window
  // doesn't flash to a spinner on every probe.
  if (loaded.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Spinner size="md" />
            <span className="text-[10px] text-neutral-600">{t('timeseries.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden relative">
      {error && (
        <p role="alert" className="text-[10px] text-red-600">
          {t('timeseries.loadFailed')} {error.message}
        </p>
      )}
      {points.some((point) => 'type' in point.location) && (
        <p className="text-[10px] text-neutral-500" title={t('timeseries.zonalHelp')}>
          {t('timeseries.zonalMean')}
        </p>
      )}
      {isLoading && (
        <div className="absolute top-2 right-2 z-10">
          <div className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-md shadow-sm border border-neutral-200">
            <Spinner size="xs" />
            <span className="text-[9px] text-neutral-600">{t('timeseries.updating')}</span>
          </div>
        </div>
      )}
      <div
        className="flex-1 min-h-0 flex flex-col transition-opacity duration-300 ease-in-out"
        style={{ opacity: isLoading && loaded.length < points.length ? 0.6 : 1 }}
      >
        <Chart series={series} points={loaded} />
      </div>
    </div>
  );
}
