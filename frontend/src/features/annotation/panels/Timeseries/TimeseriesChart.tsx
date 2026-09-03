import { useCampaignStore, useCatalog } from '../../stores/campaign';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  LineController,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  type ActiveElement,
  type ChartDataset,
  type ChartEvent,
  type ChartOptions,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { TimeSeriesOut } from '~/api/client';
import { nearestSlice } from '../../campaign/imageryNav';
import { probeColor } from '../../map/compose';
import { useImageryStore } from '../../stores/imagery';
import { useWorkStore } from '../../stores/work';
import type { LatLon, TimeSeriesData } from './cache';
import {
  collectSeriesLabels,
  formatDateForTooltip,
  getOptimalMonthLabels,
  parseSeriesDate,
  axisIdFor,
  referenceLinePlugin,
  seriesAxes,
  setSliceMarker,
  sliceMarkerFor,
  sliceMarkerPlugin,
} from './chartData';
import { savitzkyGolay } from './smoothing';
import { usePrefsStore } from '../../stores/prefs';

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  LineController,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  sliceMarkerPlugin,
  referenceLinePlugin,
  zoomPlugin
);

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2'];
const CLOUDY_DOT_COLOR = 'rgb(162, 159, 155)';

/** A probe's lines take the colour of its map marker, so several series at one
 *  probe are told apart by dash instead. */
const SERIES_DASHES = [[], [6, 3], [2, 2], [8, 3, 2, 3]];

const MIN_VISIBLE_POINTS = 3;

type LineDataset = ChartDataset<'line', (number | null)[]>;

/** One location on the chart: the task's own point (probeIndex null) or a
 *  probe the user dropped. */
export interface ChartPoint {
  key: string;
  latLon: LatLon;
  /** Appended to each series name in the legend. */
  label: string;
  probeIndex: number | null;
}

export interface ChartProps {
  series: TimeSeriesOut[];
  /** Every location with data, in draw order. */
  points: { point: ChartPoint; data: TimeSeriesData }[];
}

export function Chart({ series, points }: ChartProps) {
  const catalog = useCatalog();
  const view = useCampaignStore((s) => s.view);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS<'line'> | null>(null);

  // Held in the preference store, not here: switching task drops this chart
  // back to a spinner and unmounts it, so local state would reset every time.
  const { removeCloudy, showDots, smoothEnabled, smoothing } = usePrefsStore(
    (s) => s.timeseriesChart
  );
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());
  const [isZoomed, setIsZoomed] = useState(false);

  const toggleDataset = useCallback((index: number) => {
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Toggling every probe series off in the legend also takes the map's probe
  // markers away, so the two never disagree about whether those points are
  // being looked at.
  const markerHidden = useMemo(() => {
    const probeDatasets = points.flatMap(({ point }, group) =>
      point.probeIndex === null ? [] : series.map((_, i) => group * series.length + i)
    );
    return probeDatasets.length > 0 && probeDatasets.every((i) => hiddenDatasets.has(i));
  }, [points, series, hiddenDatasets]);

  useEffect(() => {
    useWorkStore.getState().setProbeMarkerHidden(markerHidden);
    return () => useWorkStore.getState().setProbeMarkerHidden(false);
  }, [markerHidden]);

  // Adding or dropping a point shifts every dataset index after it, so the
  // hidden set is cleared rather than left pointing at whatever moved into
  // those slots.
  const pointsKey = points.map(({ point }) => point.key).join('|');
  useEffect(() => {
    setHiddenDatasets(new Set());
  }, [pointsKey]);

  const axes = useMemo(() => seriesAxes(series.map((s) => s.index)), [series]);

  // An axis carrying one index takes that series' colour, which is what ties a
  // line to the scale it is read against; a shared axis stays neutral rather
  // than claiming one of its series' colours.
  const axisColor = useCallback(
    (axisId: string) => {
      const owned = series.findIndex((ts) => axisIdFor(axes, ts.index) === axisId);
      const single = axes.find((a) => a.id === axisId)?.indexKeys.length === 1;
      return single && owned >= 0 ? COLORS[owned % COLORS.length] : '#a3a3a3';
    },
    [axes, series]
  );

  const chartData = useMemo(() => {
    // x-axis labels from this chart's own series, so a 2022 window and a
    // 2018 window each span just the years they cover instead of a shared axis.
    const labels = collectSeriesLabels(
      series.map((ts) => ts.id),
      ...points.map(({ data }) => data)
    );
    const monthLabels = getOptimalMonthLabels(labels);
    const dotRadius = showDots ? 1.5 : 0;

    const buildDataset = (
      ts: TimeSeriesOut,
      index: number,
      source: TimeSeriesData,
      point: ChartPoint,
      datasetIndex: number
    ): LineDataset => {
      const rows = source[ts.id] ?? [];
      const rowMap = new Map(rows.map((r) => [r.time, r]));
      const color =
        point.probeIndex === null ? COLORS[index % COLORS.length] : probeColor(point.probeIndex);

      const rawData = labels.map((time) => {
        const row = rowMap.get(time);
        if (!row) return null;
        if (removeCloudy && row.cloud === 1) return null;
        return row.values;
      });
      const finalData = smoothEnabled
        ? savitzkyGolay(rawData, smoothing.window, smoothing.order)
        : rawData;

      return {
        label: `${ts.name}${point.label}`,
        yAxisID: axisIdFor(axes, ts.index),
        borderDash: point.probeIndex === null ? [] : SERIES_DASHES[index % SERIES_DASHES.length],
        data: finalData,
        borderColor: color,
        backgroundColor: color,
        pointRadius: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return 0;
          if (removeCloudy && row.cloud === 1) return 0;
          return dotRadius;
        }),
        pointBackgroundColor: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return color;
          return row.cloud === 1 ? CLOUDY_DOT_COLOR : color;
        }),
        pointBorderColor: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return color;
          return row.cloud === 1 ? CLOUDY_DOT_COLOR : color;
        }),
        tension: 0.1,
        spanGaps: true,
        hidden: hiddenDatasets.has(datasetIndex),
      };
    };

    const datasets: LineDataset[] = points.flatMap(({ point, data }, group) =>
      series.map((ts, index) => buildDataset(ts, index, data, point, group * series.length + index))
    );

    return { labels, datasets, monthLabels };
  }, [series, points, removeCloudy, showDots, smoothEnabled, smoothing, hiddenDatasets, axes]);

  // Resolve the slice currently shown on the map so its date range can be
  // highlighted on the chart. Selecting the slice itself, rather than the
  // address it lives at, keeps a re-address that lands on the same slice from
  // re-rendering the chart.
  const setImageryAddress = useImageryStore((s) => s.setAddress);
  const activeSlice = useImageryStore((s) =>
    s.address
      ? (catalog.collections.get(s.address.collectionId)?.slices[s.address.sliceIndex] ?? null)
      : null
  );

  const sliceMarker = useMemo(
    () => sliceMarkerFor(chartData.labels, activeSlice?.start_date, activeSlice?.end_date),
    [chartData.labels, activeSlice]
  );

  // Reads the address off the store rather than closing over it, so a slice
  // change leaves the chart's options - and with them its datasets - alone.
  const handleChartClick = useCallback(
    (event: ChartEvent, _elements: ActiveElement[], chart: ChartJS<'line'>) => {
      const labels = chartData.labels;
      if (!labels.length || event.x == null) return;
      const xScale = chart.scales.x;
      if (!xScale) return;
      const rawIdx = xScale.getValueForPixel(event.x);
      if (rawIdx == null) return;
      const labelIdx = Math.max(0, Math.min(labels.length - 1, Math.round(rawIdx)));
      const clickedTime = parseSeriesDate(labels[labelIdx]);
      if (Number.isNaN(clickedTime)) return;

      const target = nearestSlice(catalog, clickedTime, useImageryStore.getState().address, view);
      if (target) setImageryAddress(target);
    },
    [chartData.labels, catalog, view, setImageryAddress]
  );

  const handleResetZoom = useCallback(() => chartRef.current?.resetZoom(), []);

  const handleZoomOrPanComplete = useCallback(({ chart }: { chart: ChartJS }) => {
    setIsZoomed(chart.isZoomedOrPanned());
  }, []);

  // Memoized so its identity stays stable across re-renders that don't
  // actually change anything it reads - react-driven chart.js updates run a
  // full reprocessing pass whenever the options object changes.
  const chartOptions = useMemo<ChartOptions<'line'>>(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: handleChartClick,
      onHover: (event) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) target.style.cursor = catalog.sources.size > 0 ? 'pointer' : 'default';
      },
      animation: { duration: 400, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        referenceLines: { values: axes[0].referenceLines, axisId: axes[0].id },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const dateStr = chartData.labels[items[0].dataIndex];
              return dateStr ? formatDateForTooltip(dateStr) : '';
            },
          },
        },
        zoom: {
          limits: { x: { minRange: MIN_VISIBLE_POINTS } },
          pan: { enabled: true, mode: 'x', onPanComplete: handleZoomOrPanComplete },
          zoom: {
            wheel: { enabled: true, modifierKey: 'ctrl', speed: 0.15 },
            mode: 'x',
            onZoomComplete: handleZoomOrPanComplete,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 45,
            font: { size: 8 },
            callback: (_value, index) => {
              const monthLabel = chartData.monthLabels.find((m) => m.index === index);
              return monthLabel ? monthLabel.label : null;
            },
            autoSkip: false,
          },
          grid: { display: false },
        },
        ...Object.fromEntries(
          axes.map((axis) => [
            axis.id,
            {
              position: axis.position,
              min: axis.min,
              max: axis.max,
              ticks: { font: { size: 8 }, maxTicksLimit: 5, color: axisColor(axis.id) },
              title:
                axes.length > 1
                  ? {
                      display: true,
                      text: axis.indexKeys.join(', '),
                      font: { size: 9 },
                      color: axisColor(axis.id),
                    }
                  : undefined,
              // Only the left axis draws gridlines, so a second scale does not
              // lay a second set of lines over the same plot.
              grid: { color: '#e5e5e5', drawOnChartArea: axis.position === 'left' },
            },
          ])
        ),
      },
      elements: {
        point: { radius: 0 },
        line: { borderWidth: 1.5 },
      },
    };
  }, [handleChartClick, catalog, chartData, handleZoomOrPanComplete, axes, axisColor]);

  // Create the chart.js instance once; destroy it on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new ChartJS(canvas, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {},
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  // Push every subsequent data/options change into the live instance.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data = { labels: chartData.labels, datasets: chartData.datasets };
    chart.options = chartOptions;
    chart.update();
  }, [chartData, chartOptions]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart) setSliceMarker(chart, sliceMarker);
  }, [sliceMarker]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div className="flex justify-between items-start mb-1 flex-shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {points.map(({ point }, group) =>
            series.map((ts, index) => {
              const dsIndex = group * series.length + index;
              const isProbe = point.probeIndex !== null;
              const color = isProbe
                ? probeColor(point.probeIndex ?? 0)
                : COLORS[index % COLORS.length];
              const isHidden = hiddenDatasets.has(dsIndex);
              const name = `${ts.name}${point.label}`;
              return (
                <button
                  key={`${point.key}-${ts.id}`}
                  className="flex items-center gap-1 cursor-pointer hover:opacity-80"
                  onClick={() => toggleDataset(dsIndex)}
                  title={isHidden ? `Show ${name}` : `Hide ${name}`}
                >
                  {isProbe ? (
                    <div
                      className="w-2 h-0.5 border-t-2 transition-opacity"
                      style={{ borderColor: color, opacity: isHidden ? 0.3 : 1 }}
                    />
                  ) : (
                    <div
                      className="w-2 h-2 rounded-sm transition-opacity"
                      style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }}
                    />
                  )}
                  <span
                    className={`text-[9px] font-bold transition-opacity ${
                      isHidden
                        ? 'line-through text-neutral-400'
                        : isProbe
                          ? 'text-neutral-500'
                          : 'text-neutral-700'
                    }`}
                  >
                    {name}
                  </span>
                </button>
              );
            })
          )}
          {isZoomed && (
            <button
              className="text-[9px] text-brand-600 hover:text-brand-700 font-medium ml-1 cursor-pointer"
              onClick={handleResetZoom}
              title="Reset zoom"
            >
              Reset zoom
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
