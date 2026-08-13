import { useCampaignStore } from '../../stores/campaign';
import { useEffect, useMemo, useState } from 'react';
import type { TimeseriesWindow } from '../../domain/catalog';
import { Spinner } from '~/shared/ui/Spinner';
import type { LonLat } from '../../map/types';
import { useWorkStore } from '../../stores/work';
import { useMapFocus } from '../../stores/tasks';
import { Chart } from './TimeseriesChart';
import { timeSeriesCache, type LatLon, type TimeSeriesData } from './cache';
import { handleError } from '~/shared/utils/errorHandler';

export interface TimeseriesPanelProps {
  window: TimeseriesWindow;
}

const toLatLon = (point: LonLat | null | undefined): LatLon | null =>
  point ? { lat: point[1], lon: point[0] } : null;

export function TimeseriesPanel({ window: tsWindow }: TimeseriesPanelProps) {
  const mode = useCampaignStore((s) => s.workMode);
  // Panel composition rebuilds the window (and with it this array) whenever
  // the page recomposes, e.g. on every collection change. Keying on the
  // series' contents instead keeps the fetch and the chart's datasets put.
  const seriesKey = tsWindow.series.map((ts) => `${ts.id}:${ts.name}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const series = useMemo(() => tsWindow.series, [seriesKey]);
  const ids = useMemo(() => series.map((ts) => ts.id), [series]);
  const isOpenMode = mode === 'explore';

  const focus = useMapFocus();
  const probePoint = useWorkStore((s) => s.probePoint);
  const latLon = isOpenMode ? toLatLon(probePoint) : toLatLon(focus?.center);
  const probeLatLon = isOpenMode ? null : toLatLon(probePoint);
  // Stable identity: the prefetch effect keys on this array, and mapFocus only
  // publishes a new `upcoming` when the points themselves change.
  const upcoming = focus?.upcoming;
  const prefetchCoordinates = useMemo(
    () => (upcoming ?? []).map((p) => ({ lat: p[1], lon: p[0] })),
    [upcoming]
  );

  const [data, setData] = useState<TimeSeriesData | null>(null);
  const [probeData, setProbeData] = useState<TimeSeriesData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProbeLoading, setIsProbeLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!latLon || ids.length === 0) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    timeSeriesCache
      .get(ids, latLon)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        handleError(err, 'Failed to load time series data', { showUser: false });
        if (cancelled) return;
        setData(null);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Only re-fetch when the point (or the series list) actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, latLon?.lat, latLon?.lon]);

  useEffect(() => {
    if (ids.length === 0 || prefetchCoordinates.length === 0) return;
    timeSeriesCache.prefetch(ids, prefetchCoordinates);
  }, [ids, prefetchCoordinates]);

  useEffect(() => {
    if (isOpenMode || !probeLatLon || ids.length === 0) {
      setProbeData(null);
      setIsProbeLoading(false);
      return;
    }

    let cancelled = false;
    setIsProbeLoading(true);

    timeSeriesCache
      .get(ids, probeLatLon)
      .then((result) => {
        if (!cancelled) setProbeData(result);
      })
      .catch((err) => {
        handleError(err, 'Failed to load probe time series data', { showUser: false });
        if (!cancelled) setProbeData(null);
      })
      .finally(() => {
        if (!cancelled) setIsProbeLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, isOpenMode, probeLatLon?.lat, probeLatLon?.lon]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[10px] text-red-600">Failed to load time series data</p>
        </div>
      </div>
    );
  }

  if (!latLon) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[10px] text-neutral-500">No location selected</p>
        </div>
      </div>
    );
  }

  // Show a full loading state only on the very first load; a subsequent
  // point change fades the existing chart instead (opacity below) so the
  // window doesn't flash to a spinner on every click.
  if (!data) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Spinner size="md" />
            <span className="text-[10px] text-neutral-600">Loading time series...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden relative">
      {(isLoading || isProbeLoading) && (
        <div className="absolute top-2 right-2 z-10">
          <div className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-md shadow-sm border border-neutral-200">
            <Spinner size="xs" />
            <span className="text-[9px] text-neutral-600">
              {isProbeLoading && !isLoading ? 'Loading probe...' : 'Updating...'}
            </span>
          </div>
        </div>
      )}
      <div
        className="flex-1 min-h-0 flex flex-col transition-opacity duration-300 ease-in-out"
        style={{ opacity: isLoading ? 0.4 : 1 }}
      >
        <Chart series={series} data={data} probeData={probeData} isOpenMode={isOpenMode} />
      </div>
    </div>
  );
}
