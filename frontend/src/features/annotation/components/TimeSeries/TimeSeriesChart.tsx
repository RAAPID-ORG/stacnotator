/**
 * TimeSeriesChart - Main component for time series visualization
 *
 * Handles data fetching with caching/prefetching, rendering the chart, and UI controls.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { TimeSeriesOut } from '~/api/client';
import { timeSeriesCache, type TimeSeriesData, type TimeSeriesRow } from './timeSeriesCache';
import { formatDateForTooltip, getOptimalMonthLabels } from './chartUtils';
import { savitzkyGolay } from './savitzkyGolay';
import type { LatLon } from '~/shared/utils/utility';
import { useMapStore } from '../../stores/map.store';
import { useCampaignStore } from '../../stores/campaign.store';

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  zoomPlugin
);

interface TimeSeriesChartProps {
  timeseries: TimeSeriesOut[];
  latLon: LatLon | null;
  prefetchCoordinates?: LatLon[];
  probeLatLon?: LatLon | null; // Additional probe point for comparison (task mode)
}

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2'];
const PROBE_COLORS = ['#f97316', '#84cc16', '#f43f5e', '#a78bfa', '#fb923c', '#22d3ee'];

export const TimeSeriesChart = ({
  timeseries,
  latLon,
  prefetchCoordinates = [],
  probeLatLon,
}: TimeSeriesChartProps) => {
  const chartRef = useRef<ChartJS<'line'>>(null);
  const [data, setData] = useState<TimeSeriesData | null>(null);
  const [probeData, setProbeData] = useState<TimeSeriesData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProbeLoading, setIsProbeLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [removeCloudy, setRemoveCloudy] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [smoothEnabled, setSmoothEnabled] = useState(false);
  const [smoothWindow, setSmoothWindow] = useState(7);
  const [smoothOrder, setSmoothOrder] = useState(3);
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());
  const [isZoomed, setIsZoomed] = useState(false);

  const handleResetZoom = useCallback(() => {
    chartRef.current?.resetZoom();
    setIsZoomed(false);
  }, []);

  const toggleDataset = useCallback((index: number) => {
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const timeseriesIds = useMemo(() => timeseries.map((ts) => ts.id), [timeseries]);

  // Fetch data for current location
  useEffect(() => {
    if (!latLon || timeseriesIds.length === 0) {
      setData(null);
      setIsLoading(false);
      setError(null);
      setOpacity(1);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    // Fade out current chart slightly
    setOpacity(0.4);

    timeSeriesCache
      .get(timeseriesIds, latLon)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);

          // Fade in new chart
          setOpacity(1);
        }
      })
      .catch((err) => {
        console.error('Failed to load time series data:', err);
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error ? err : new Error('Unknown error'));
          setOpacity(1);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [timeseriesIds, latLon]);

  // Prefetch upcoming coordinates
  useEffect(() => {
    if (timeseriesIds.length === 0 || prefetchCoordinates.length === 0) {
      return;
    }

    timeSeriesCache.prefetch(timeseriesIds, prefetchCoordinates);
  }, [timeseriesIds, prefetchCoordinates]);

  // Fetch data for probe location (additional comparison point)
  useEffect(() => {
    if (!probeLatLon || timeseriesIds.length === 0) {
      setProbeData(null);
      setIsProbeLoading(false);
      return;
    }

    let cancelled = false;
    setIsProbeLoading(true);

    timeSeriesCache
      .get(timeseriesIds, probeLatLon)
      .then((result) => {
        if (!cancelled) {
          setProbeData(result);
        }
      })
      .catch((err) => {
        console.error('Failed to load probe time series data:', err);
        if (!cancelled) {
          setProbeData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsProbeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when lat/lon change
  }, [timeseriesIds, probeLatLon?.lat, probeLatLon?.lon]);

  // Whether the on-map probe marker corresponds to probe series (task mode)
  // or to the main series (open mode). The Canvas passes probeLatLon=undefined
  // in open mode and a value (possibly null) in task mode.
  const isOpenMode = probeLatLon === undefined;

  // When the user clicks a new point, ensure the relevant legend toggles are
  // reset so the marker reappears on screen.
  useEffect(() => {
    if (!probeLatLon) return;
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < timeseries.length; i++) next.delete(timeseries.length + i);
      return next;
    });
  }, [probeLatLon?.lat, probeLatLon?.lon, timeseries.length]);

  useEffect(() => {
    if (!isOpenMode || !latLon) return;
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < timeseries.length; i++) next.delete(i);
      return next;
    });
  }, [isOpenMode, latLon?.lat, latLon?.lon, timeseries.length]);

  // Sync map-marker visibility with the legend so toggling everything off in
  // the chart hides the on-map crosshair too.
  const markerHidden = useMemo(() => {
    if (timeseries.length === 0) return false;
    if (probeLatLon) {
      return timeseries.every((_, i) => hiddenDatasets.has(timeseries.length + i));
    }
    if (isOpenMode && latLon) {
      return timeseries.every((_, i) => hiddenDatasets.has(i));
    }
    return false;
  }, [hiddenDatasets, timeseries, probeLatLon, latLon, isOpenMode]);

  useEffect(() => {
    useMapStore.getState().setProbeMarkerHidden(markerHidden);
    return () => {
      useMapStore.getState().setProbeMarkerHidden(false);
    };
  }, [markerHidden]);

  const chartData = useMemo(() => {
    if (!data) return null;

    // Union of all timestamps (from both task and probe data)
    const labelSet = new Set<string>();
    Object.values(data).forEach((rows: TimeSeriesRow[]) =>
      rows.forEach((row: TimeSeriesRow) => labelSet.add(row.time))
    );
    if (probeData) {
      Object.values(probeData).forEach((rows: TimeSeriesRow[]) =>
        rows.forEach((row: TimeSeriesRow) => labelSet.add(row.time))
      );
    }
    const labels = Array.from(labelSet).sort();

    // Get optimal month labels for x-axis
    const monthLabels = getOptimalMonthLabels(labels);

    // Create datasets for main task point
    const datasets: Array<{
      label: string;
      data: (number | null)[];
      borderColor: string;
      backgroundColor: string;
      pointRadius: number[];
      pointBackgroundColor: string[];
      pointBorderColor: string[];
      tension: number;
      spanGaps: boolean;
      hidden?: boolean;
    }> = timeseries.map((ts, index) => {
      const rows = data[ts.id] ?? [];
      const rowMap = new Map(rows.map((r: TimeSeriesRow) => [r.time, r]));

      const color = COLORS[index % COLORS.length];

      const rawData = labels.map((time) => {
        const row = rowMap.get(time);
        if (!row) return null;
        if (removeCloudy && row.cloud === 1) return null;
        return row.values;
      });

      const finalData = smoothEnabled ? savitzkyGolay(rawData, smoothWindow, smoothOrder) : rawData;

      return {
        label: ts.name,
        data: finalData,
        borderColor: color,
        backgroundColor: color,
        pointRadius: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return 0;
          if (!removeCloudy && row.cloud === 1) return 1.5;
          return 0;
        }),
        pointBackgroundColor: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return color;
          return row.cloud === 1 ? '#ef4444' : color;
        }),
        pointBorderColor: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return color;
          return row.cloud === 1 ? '#ef4444' : color;
        }),
        tension: 0.1,
        spanGaps: true,
        hidden: hiddenDatasets.has(index),
      };
    });

    // Create datasets for probe point (dashed lines)
    if (probeData) {
      timeseries.forEach((ts, index) => {
        const rows = probeData[ts.id] ?? [];
        const rowMap = new Map(rows.map((r: TimeSeriesRow) => [r.time, r]));

        const color = PROBE_COLORS[index % PROBE_COLORS.length];

        const rawData = labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return null;
          if (removeCloudy && row.cloud === 1) return null;
          return row.values;
        });

        const finalData = smoothEnabled
          ? savitzkyGolay(rawData, smoothWindow, smoothOrder)
          : rawData;

        datasets.push({
          label: `${ts.name} (probe)`,
          data: finalData,
          borderColor: color,
          backgroundColor: color,
          pointRadius: labels.map((time) => {
            const row = rowMap.get(time);
            if (!row) return 0;
            if (!removeCloudy && row.cloud === 1) return 1.5;
            return 0;
          }),
          pointBackgroundColor: labels.map((time) => {
            const row = rowMap.get(time);
            if (!row) return color;
            return row.cloud === 1 ? '#ef4444' : color;
          }),
          pointBorderColor: labels.map((time) => {
            const row = rowMap.get(time);
            if (!row) return color;
            return row.cloud === 1 ? '#ef4444' : color;
          }),
          tension: 0.1,
          spanGaps: true,
          hidden: hiddenDatasets.has(timeseries.length + index),
        });
      });
    }

    return { labels, datasets, monthLabels };
  }, [
    data,
    probeData,
    timeseries,
    removeCloudy,
    smoothEnabled,
    smoothWindow,
    smoothOrder,
    hiddenDatasets,
  ]);

  // Resolve the slice currently shown on the map so we can highlight its
  // date range on the chart. Pulls from stores directly to keep the call
  // site (Canvas) untouched.
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const campaign = useCampaignStore((s) => s.campaign);
  const activeSlice = useMemo(() => {
    if (!campaign || activeCollectionId === null) return null;
    for (const src of campaign.imagery_sources) {
      const col = src.collections.find((c) => c.id === activeCollectionId);
      if (col) return col.slices[activeSliceIndex] ?? null;
    }
    return null;
  }, [campaign, activeCollectionId, activeSliceIndex]);

  // Map slice start/end dates → label indices (categorical x-axis).
  // Use the closest label inside the slice range; if no label falls inside
  // (e.g. labels are sparse compared to slice width) snap to nearest.
  const sliceMarkerRef = useRef<{ startIdx: number; endIdx: number } | null>(null);
  useEffect(() => {
    if (!activeSlice || !chartData?.labels.length) {
      sliceMarkerRef.current = null;
      chartRef.current?.update('none');
      return;
    }
    const sliceStart = new Date(activeSlice.start_date).getTime();
    const sliceEnd = new Date(activeSlice.end_date).getTime();
    const labels = chartData.labels;
    let startIdx = -1;
    let endIdx = -1;
    for (let i = 0; i < labels.length; i++) {
      const t = new Date(labels[i]).getTime();
      if (t >= sliceStart && t <= sliceEnd) {
        if (startIdx === -1) startIdx = i;
        endIdx = i;
      }
    }
    if (startIdx === -1) {
      // No labels strictly inside the slice — snap to the nearest single label
      let nearest = 0;
      let bestDist = Infinity;
      const center = (sliceStart + sliceEnd) / 2;
      for (let i = 0; i < labels.length; i++) {
        const t = new Date(labels[i]).getTime();
        const d = Math.abs(t - center);
        if (d < bestDist) {
          bestDist = d;
          nearest = i;
        }
      }
      sliceMarkerRef.current = { startIdx: nearest, endIdx: nearest };
    } else {
      sliceMarkerRef.current = { startIdx, endIdx };
    }
    chartRef.current?.update('none');
  }, [activeSlice, chartData?.labels]);

  // Inline plugin: subtle band + edge lines indicating the active map slice.
  const sliceMarkerPlugin = useMemo(
    () => ({
      id: 'sliceMarker',
      afterDatasetsDraw(chart: ChartJS<'line'>) {
        const marker = sliceMarkerRef.current;
        if (!marker) return;
        const xScale = chart.scales.x;
        if (!xScale) return;
        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        // Half-step padding so a single-point slice gets a visible band.
        const halfStep =
          marker.endIdx === marker.startIdx
            ? Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2 || 4
            : 0;
        const xLeft = xScale.getPixelForValue(marker.startIdx) - halfStep;
        const xRight = xScale.getPixelForValue(marker.endIdx) + halfStep;
        const left = Math.max(chartArea.left, Math.min(xLeft, xRight));
        const right = Math.min(chartArea.right, Math.max(xLeft, xRight));
        if (right <= chartArea.left || left >= chartArea.right) return;

        ctx.save();
        // Soft fill band
        ctx.fillStyle = 'rgba(245, 158, 11, 0.10)'; // amber tint
        ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);

        // Edge lines
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(Math.round(left) + 0.5, chartArea.top);
        ctx.lineTo(Math.round(left) + 0.5, chartArea.bottom);
        if (right - left > 1) {
          ctx.moveTo(Math.round(right) + 0.5, chartArea.top);
          ctx.lineTo(Math.round(right) + 0.5, chartArea.bottom);
        }
        ctx.stroke();
        ctx.restore();
      },
    }),
    []
  );

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-[10px] text-red-600">Failed to load time series data</p>
          </div>
        </div>
      </div>
    );
  }

  // No location selected
  if (!latLon) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[10px] text-neutral-500">No location selected</p>
        </div>
      </div>
    );
  }

  // Show loading state only on initial load
  if (!data) {
    return (
      <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-neutral-300 border-t-brand-600"></div>
            <span className="text-[10px] text-neutral-600">Loading time series...</span>
          </div>
        </div>
      </div>
    );
  }

  // Chart rendering
  if (!chartData) return null;

  return (
    <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden relative">
      {/* Loading indicator overlay */}
      {(isLoading || isProbeLoading) && (
        <div className="absolute top-2 right-2 z-10">
          <div className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-md shadow-sm border border-neutral-200">
            <div className="animate-spin rounded-full h-3 w-3 border border-neutral-300 border-t-brand-600"></div>
            <span className="text-[9px] text-neutral-600">
              {isProbeLoading && !isLoading ? 'Loading probe...' : 'Updating...'}
            </span>
          </div>
        </div>
      )}

      {/* Header with Legend and Controls */}
      <div className="flex justify-between items-start mb-1 flex-shrink-0 gap-2 flex-wrap overflow-hidden">
        {/* Legend (click to toggle traces, hover for the cloud-dot +
            savgol explanation). Tooltip is attached to the whole legend
            block so every legend item triggers it. */}
        <div className="relative group flex items-center gap-2 flex-wrap min-w-0">
          {/* Explanatory tooltip - shown whenever the user lingers on the
              legend, which is where they're already looking to read dataset
              names. Explains the red dots + how the two filters interact. */}
          <div className="absolute top-full left-0 mt-1 w-72 px-3 py-2 bg-neutral-800 text-white text-[11px] leading-relaxed rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none z-50 text-left space-y-1.5">
            <p>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1 align-middle" />
              <strong>Red dots</strong> are days flagged as cloudy on this point by Cloud Score+
              (S2) or SCL (others).
            </p>
            <p>
              <strong>Remove cloudy</strong> drops those observations from both the raw series and
              the smoothed line.
            </p>
            <p>
              <strong>Smooth</strong> fits a Savitzky-Golay filter over whatever remains. If you
              leave cloudy points in, the filter will pull the smoothed line toward them - usually
              you want both toggles on together.
            </p>
            <div className="absolute bottom-full left-3 border-4 border-transparent border-b-neutral-800" />
          </div>
          {timeseries.map((ts, index) => {
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
            timeseries.map((ts, index) => {
              const color = PROBE_COLORS[index % PROBE_COLORS.length];
              const dsIndex = timeseries.length + index;
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
              title="Reset zoom (double-click chart)"
            >
              Reset zoom
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          <label className="flex items-center gap-1 cursor-pointer flex-shrink-0">
            <span
              className="text-[10px] text-neutral-600"
              title="Removes days with clouds on the point (red dots)"
            >
              Remove cloudy
            </span>
            <div
              className={`relative w-6 h-3.5 rounded-full transition-colors ${removeCloudy ? 'bg-brand-600' : 'bg-neutral-300'}`}
              onClick={() => setRemoveCloudy(!removeCloudy)}
              title="Removes days with clouds on the point (red dots)"
            >
              <div
                className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${removeCloudy ? 'translate-x-3' : 'translate-x-0.5'}`}
              />
            </div>
          </label>

          {/* Smoothing toggle + parameters */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <label className="flex items-center gap-1 cursor-pointer">
              <span className="text-[10px] text-neutral-600" title="Savitzky-Golay Smoothing.">
                Smooth
              </span>
              <div
                className={`relative w-6 h-3.5 rounded-full transition-colors ${smoothEnabled ? 'bg-brand-600' : 'bg-neutral-300'}`}
                onClick={() => setSmoothEnabled(!smoothEnabled)}
                title="Savitzky-Golay Smoothing."
              >
                <div
                  className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${smoothEnabled ? 'translate-x-3' : 'translate-x-0.5'}`}
                />
              </div>
            </label>
            {smoothEnabled && (
              <div className="flex items-center gap-1 ml-1">
                <label
                  className="flex items-center gap-0.5"
                  title="Window size for Savitzky-Golay smoothing (odd number ≥ 5, larger = smoother)"
                >
                  <span className="text-[9px] text-neutral-500">W</span>
                  <input
                    type="number"
                    min={5}
                    max={31}
                    step={2}
                    value={smoothWindow}
                    onChange={(e) => {
                      let v = parseInt(e.target.value, 10);
                      if (isNaN(v)) return;
                      v = Math.max(5, Math.min(31, v));
                      if (v % 2 === 0) v += 1;
                      setSmoothWindow(v);
                      // Ensure poly order stays valid
                      if (smoothOrder >= v) setSmoothOrder(Math.max(1, v - 2));
                    }}
                    className="w-8 text-[9px] px-0.5 py-0 bg-white border border-neutral-300 rounded text-center"
                  />
                </label>
                <label
                  className="flex items-center gap-0.5"
                  title="Polynomial order (≥ 1, must be less than window size)"
                >
                  <span className="text-[9px] text-neutral-500">P</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.min(5, smoothWindow - 1)}
                    value={smoothOrder}
                    onChange={(e) => {
                      let v = parseInt(e.target.value, 10);
                      if (isNaN(v)) return;
                      v = Math.max(1, Math.min(smoothWindow - 1, v));
                      setSmoothOrder(v);
                    }}
                    className="w-8 text-[9px] px-0.5 py-0 bg-white border border-neutral-300 rounded text-center"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart with smooth transition */}
      <div
        className="flex-1 min-h-0 w-full transition-opacity duration-300 ease-in-out"
        style={{ opacity }}
      >
        <Line
          ref={chartRef}
          data={chartData}
          plugins={[sliceMarkerPlugin]}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: {
              duration: 400,
              easing: 'easeInOutQuart',
            },
            plugins: {
              legend: {
                display: false,
              },
              tooltip: {
                callbacks: {
                  title: (items) => {
                    if (!items.length) return '';
                    const dateStr = chartData.labels[items[0].dataIndex];
                    return formatDateForTooltip(dateStr);
                  },
                },
              },
              zoom: {
                pan: {
                  enabled: true,
                  mode: 'x',
                  onPan: () => setIsZoomed(true),
                },
                zoom: {
                  wheel: { enabled: true, modifierKey: 'ctrl' as const },
                  pinch: { enabled: true },
                  drag: {
                    enabled: true,
                    backgroundColor: 'rgba(37,99,235,0.1)',
                    borderColor: '#2563eb',
                    borderWidth: 1,
                  },
                  mode: 'x',
                  onZoom: () => setIsZoomed(true),
                },
              },
            },
            scales: {
              x: {
                ticks: {
                  maxRotation: 45,
                  minRotation: 45,
                  font: { size: 8 },
                  callback: function (_value, index) {
                    const monthLabel = chartData.monthLabels.find((m) => m.index === index);
                    return monthLabel ? monthLabel.label : null;
                  },
                  autoSkip: false,
                },
                grid: {
                  display: false,
                },
              },
              y: {
                min: 0,
                max: 1,
                ticks: {
                  font: { size: 8 },
                  maxTicksLimit: 5,
                },
                grid: {
                  color: '#e5e5e5',
                },
              },
            },
            elements: {
              point: {
                radius: 0,
              },
              line: {
                borderWidth: 1.5,
              },
            },
          }}
        />
      </div>
    </div>
  );
};
