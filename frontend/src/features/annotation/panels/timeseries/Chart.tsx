import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { nearestSlice } from '~/features/annotation/core/catalog';
import { useImageryStore } from '~/features/annotation/stores';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { IconInfo, IconSliders } from '~/shared/ui/Icons';
import type { ComposeCtx } from '../../composition';
import { setProbeMarkerHidden } from '../../shared/interactionSpec';
import type { TimeSeriesData } from './lib/cache';
import {
  collectSeriesLabels,
  formatDateForTooltip,
  getOptimalMonthLabels,
  parseSeriesDate,
  referenceLinePlugin,
  sliceMarkerPlugin,
  type SliceMarker,
} from './lib/chartData';
import { savitzkyGolay } from './lib/smoothing';
import { OptionsPopover, type SmoothingOptions } from './OptionsPopover';

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
const PROBE_COLORS = ['#f97316', '#84cc16', '#f43f5e', '#a78bfa', '#fb923c', '#22d3ee'];
const CLOUDY_DOT_COLOR = 'rgb(162, 159, 155)';

const MIN_VISIBLE_POINTS = 3;

type LineDataset = ChartDataset<'line', (number | null)[]>;

export interface ChartProps {
  ctx: ComposeCtx;
  series: TimeSeriesOut[];
  data: TimeSeriesData;
  probeData: TimeSeriesData | null;
  /** Task mode compares two points (main + probe); explore mode charts one. */
  isOpenMode: boolean;
}

export function Chart({ ctx, series, data, probeData, isOpenMode }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS<'line'> | null>(null);

  const [removeCloudy, setRemoveCloudy] = useState(true);
  const [showDots, setShowDots] = useState(true);
  const [smoothEnabled, setSmoothEnabled] = useState(false);
  const [smoothing, setSmoothing] = useState<SmoothingOptions>({ window: 7, order: 3 });
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());
  const [isZoomed, setIsZoomed] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoBtnRef = useRef<HTMLButtonElement>(null);
  const [infoPos, setInfoPos] = useState<{ top: number; left: number } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const optionsPanelRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([optionsBtnRef, optionsPanelRef], () => setOptionsOpen(false), optionsOpen);

  const toggleDataset = useCallback((index: number) => {
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Toggling every drawn series off in the legend also takes the map's probe
  // marker away, so the two never disagree about whether that point is being
  // looked at.
  const markerHidden = useMemo(() => {
    if (series.length === 0) return false;
    if (probeData) return series.every((_, i) => hiddenDatasets.has(series.length + i));
    if (isOpenMode && data) return series.every((_, i) => hiddenDatasets.has(i));
    return false;
  }, [series, probeData, data, isOpenMode, hiddenDatasets]);

  useEffect(() => {
    setProbeMarkerHidden(markerHidden);
    return () => setProbeMarkerHidden(false);
  }, [markerHidden]);

  // A fresh point's data arriving is the moment a legend toggle should stop
  // hiding its series - otherwise a marker the user hid earlier could stay
  // invisible forever even after the point (and its meaning) has moved on.
  useEffect(() => {
    if (!probeData) return;
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < series.length; i++) next.delete(series.length + i);
      return next;
    });
  }, [probeData, series.length]);

  useEffect(() => {
    if (!isOpenMode) return;
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < series.length; i++) next.delete(i);
      return next;
    });
  }, [isOpenMode, data, series.length]);

  const chartData = useMemo(() => {
    // x-axis labels from this chart's own series, so a 2022 window and a
    // 2018 window each span just the years they cover instead of a shared axis.
    const labels = collectSeriesLabels(
      series.map((ts) => ts.id),
      data,
      probeData
    );
    const monthLabels = getOptimalMonthLabels(labels);
    const dotRadius = showDots ? 1.5 : 0;

    const buildDataset = (
      ts: TimeSeriesOut,
      index: number,
      source: TimeSeriesData,
      colors: string[],
      datasetIndex: number,
      labelSuffix: string
    ): LineDataset => {
      const rows = source[ts.id] ?? [];
      const rowMap = new Map(rows.map((r) => [r.time, r]));
      const color = colors[index % colors.length];

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
        label: `${ts.name}${labelSuffix}`,
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

    const datasets: LineDataset[] = series.map((ts, index) =>
      buildDataset(ts, index, data, COLORS, index, '')
    );
    if (probeData) {
      series.forEach((ts, index) => {
        datasets.push(
          buildDataset(ts, index, probeData, PROBE_COLORS, series.length + index, ' (probe)')
        );
      });
    }

    return { labels, datasets, monthLabels };
  }, [series, data, probeData, removeCloudy, showDots, smoothEnabled, smoothing, hiddenDatasets]);

  // Resolve the slice currently shown on the map so its date range can be
  // highlighted on the chart.
  const catalog = ctx.catalog;
  const imageryAddress = useImageryStore((s) => s.address);
  const setImageryAddress = useImageryStore((s) => s.setAddress);

  const activeSlice = useMemo(() => {
    if (!imageryAddress) return null;
    const collection = catalog.collections.get(imageryAddress.collectionId);
    return collection?.slices[imageryAddress.sliceIndex] ?? null;
  }, [catalog, imageryAddress]);

  const sliceMarker = useMemo<SliceMarker | null>(() => {
    if (!activeSlice?.start_date || !activeSlice?.end_date || !chartData.labels.length) return null;
    const sliceStart = new Date(activeSlice.start_date).getTime();
    const sliceEnd = new Date(activeSlice.end_date).getTime();
    const labels = chartData.labels;

    let startIdx = -1;
    let endIdx = -1;
    for (let i = 0; i < labels.length; i++) {
      const t = parseSeriesDate(labels[i]);
      if (t >= sliceStart && t <= sliceEnd) {
        if (startIdx === -1) startIdx = i;
        endIdx = i;
      }
    }
    if (startIdx !== -1) return { startIdx, endIdx };

    // No labels strictly inside the slice - snap to the nearest single label.
    let nearest = 0;
    let bestDist = Infinity;
    const center = (sliceStart + sliceEnd) / 2;
    for (let i = 0; i < labels.length; i++) {
      const d = Math.abs(parseSeriesDate(labels[i]) - center);
      if (d < bestDist) {
        bestDist = d;
        nearest = i;
      }
    }
    return { startIdx: nearest, endIdx: nearest };
  }, [activeSlice, chartData.labels]);

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

      const target = nearestSlice(catalog, clickedTime, imageryAddress);
      if (target) setImageryAddress(target);
    },
    [chartData.labels, catalog, imageryAddress, setImageryAddress]
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
        y: {
          min: 0,
          max: 1,
          ticks: { font: { size: 8 }, maxTicksLimit: 5 },
          grid: { color: '#e5e5e5' },
        },
      },
      elements: {
        point: { radius: 0 },
        line: { borderWidth: 1.5 },
      },
    };
  }, [handleChartClick, catalog, chartData, handleZoomOrPanComplete]);

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

  // Push every subsequent data/options/marker change into the live instance.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data = { labels: chartData.labels, datasets: chartData.datasets };
    chart.options = {
      ...chartOptions,
      plugins: { ...chartOptions.plugins, sliceMarker: { marker: sliceMarker } },
    };
    chart.update();
  }, [chartData, chartOptions, sliceMarker]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div className="flex justify-between items-start mb-1 flex-shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <button
            ref={infoBtnRef}
            type="button"
            className="flex items-center justify-center w-4 h-4 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors flex-shrink-0"
            aria-label="Time series legend explanation"
            onMouseEnter={() => {
              const r = infoBtnRef.current?.getBoundingClientRect();
              if (r) setInfoPos({ top: r.bottom + 4, left: r.left });
              setInfoOpen(true);
            }}
            onMouseLeave={() => setInfoOpen(false)}
            onFocus={() => {
              const r = infoBtnRef.current?.getBoundingClientRect();
              if (r) setInfoPos({ top: r.bottom + 4, left: r.left });
              setInfoOpen(true);
            }}
            onBlur={() => setInfoOpen(false)}
          >
            <IconInfo className="w-3 h-3" />
          </button>
          {series.map((ts, index) => {
            const color = COLORS[index % COLORS.length];
            const isHidden = hiddenDatasets.has(index);
            return (
              <button
                key={ts.id}
                className="flex items-center gap-1 cursor-pointer hover:opacity-80"
                onClick={() => toggleDataset(index)}
                title={isHidden ? `Show ${ts.name}` : `Hide ${ts.name}`}
              >
                <div
                  className="w-2 h-2 rounded-sm transition-opacity"
                  style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }}
                />
                <span
                  className={`text-[9px] font-bold transition-opacity ${isHidden ? 'line-through text-neutral-400' : 'text-neutral-700'}`}
                >
                  {ts.name}
                </span>
              </button>
            );
          })}
          {probeData &&
            series.map((ts, index) => {
              const color = PROBE_COLORS[index % PROBE_COLORS.length];
              const dsIndex = series.length + index;
              const isHidden = hiddenDatasets.has(dsIndex);
              return (
                <button
                  key={`probe-${ts.id}`}
                  className="flex items-center gap-1 cursor-pointer hover:opacity-80"
                  onClick={() => toggleDataset(dsIndex)}
                  title={isHidden ? `Show ${ts.name} (probe)` : `Hide ${ts.name} (probe)`}
                >
                  <div
                    className="w-2 h-0.5 border-t-2 transition-opacity"
                    style={{ borderColor: color, opacity: isHidden ? 0.3 : 1 }}
                  />
                  <span
                    className={`text-[9px] font-bold transition-opacity ${isHidden ? 'line-through text-neutral-400' : 'text-neutral-500'}`}
                  >
                    {ts.name} (probe)
                  </span>
                </button>
              );
            })}
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

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            ref={optionsBtnRef}
            type="button"
            className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors cursor-pointer ${optionsOpen ? 'bg-neutral-100 text-neutral-700' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'}`}
            aria-label="Chart options"
            aria-expanded={optionsOpen}
            title="Chart options"
            onClick={() => setOptionsOpen((o) => !o)}
          >
            <IconSliders className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <canvas ref={canvasRef} />
      </div>

      {optionsOpen && (
        <OptionsPopover
          ref={optionsPanelRef}
          removeCloudy={removeCloudy}
          onRemoveCloudyChange={setRemoveCloudy}
          smoothEnabled={smoothEnabled}
          onSmoothEnabledChange={setSmoothEnabled}
          smoothing={smoothing}
          onSmoothingChange={setSmoothing}
          showDots={showDots}
          onShowDotsChange={setShowDots}
        />
      )}

      {infoOpen &&
        infoPos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[10000] w-72 px-3 py-2 bg-neutral-800 text-white text-[11px] leading-relaxed rounded-md shadow-lg space-y-1.5"
            style={{
              top: infoPos.top,
              left: Math.min(
                infoPos.left,
                (infoBtnRef.current?.ownerDocument.defaultView ?? window).innerWidth - 296
              ),
            }}
          >
            <p>
              Each dot is one observation. <strong>Colored dots</strong> are clear-day observations
              (one color per series). <strong>Gray dots</strong> are observations flagged as cloudy.
            </p>
            <p>
              <strong>Remove cloudy</strong> drops the gray observations from both the raw series
              and the smoothed line.
            </p>
            <p>
              <strong>Smooth</strong> fits a Savitzky-Golay filter. If you leave cloudy points in,
              the filter pulls the smoothed line toward them - usually Remove cloudy + Smooth
              together is what you want.
            </p>
            <p>
              <strong>Dots</strong> toggles whether the per-observation markers are drawn.
            </p>
          </div>,
          infoBtnRef.current?.ownerDocument.body ?? document.body
        )}
    </div>
  );
}
