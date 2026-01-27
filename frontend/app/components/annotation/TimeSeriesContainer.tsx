import { useEffect, useMemo, useState } from "react";
import { type TimeSeriesOut } from "~/api/client";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
} from "chart.js";
import type { LatLon } from "~/utils/utility";
import { timeseriesCache, type TimeSeriesRow } from "~/utils/timeseriesCache";

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  CategoryScale
);

interface TimeSeriesContainerProps {
  timeseries: TimeSeriesOut[];
  latLon: LatLon | null;
}

const COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
];

/**
 * Format date string to "MMM 'YY" format
 * Handles both YYYYMMDD and ISO date formats
 */
const formatDateLabel = (dateStr: string): string => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Handle YYYYMMDD format
  if (/^\d{8}$/.test(dateStr)) {
    const year = dateStr.slice(0, 4);
    const month = parseInt(dateStr.slice(4, 6), 10);
    return `${monthNames[month - 1]} '${year.slice(2)}`;
  }
  
  // Handle ISO or other parseable date formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return `${monthNames[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`;
  }
  
  return dateStr;
};

/**
 * Format date string for tooltip display (e.g., "15 Jan 2025")
 */
const formatDateForTooltip = (dateStr: string): string => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Handle YYYYMMDD format
  if (/^\d{8}$/.test(dateStr)) {
    const year = dateStr.slice(0, 4);
    const month = parseInt(dateStr.slice(4, 6), 10);
    const day = parseInt(dateStr.slice(6, 8), 10);
    return `${day} ${monthNames[month - 1]} ${year}`;
  }
  
  // Handle ISO or other parseable date formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  }
  
  return dateStr;
};

/**
 * Extract month key from date string for grouping
 */
const getMonthKey = (dateStr: string): string | null => {
  // Handle YYYYMMDD format
  if (/^\d{8}$/.test(dateStr)) {
    return dateStr.slice(0, 6); // YYYYMM
  }
  
  // Handle ISO or other parseable date formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  
  return null;
};

/**
 * Get unique month labels from sorted date strings
 * Returns indices and formatted labels for the first occurrence of each month
 */
const getMonthLabels = (dates: string[]): { index: number; label: string }[] => {
  const seen = new Set<string>();
  const result: { index: number; label: string }[] = [];
  
  dates.forEach((date, index) => {
    const monthKey = getMonthKey(date);
    if (monthKey && !seen.has(monthKey)) {
      seen.add(monthKey);
      result.push({ index, label: formatDateLabel(date) });
    }
  });
  
  return result;
};

/**
 * Calculate optimal label interval based on total months
 * Returns interval in months (1, 2, 3, 4, 6, or 12)
 */
const calculateLabelInterval = (totalMonths: number): number => {
  if (totalMonths <= 6) return 1;      // 6 months or less: show every month
  if (totalMonths <= 12) return 2;     // 7-12 months: show every 2 months
  if (totalMonths <= 18) return 3;     // 13-18 months: show every 3 months
  if (totalMonths <= 24) return 4;     // 19-24 months: show every 4 months
  if (totalMonths <= 36) return 6;     // 25-36 months: show every 6 months
  return 12;                            // More than 36 months: show every year
};

/**
 * Get optimally spaced month labels based on data range
 * Returns indices and formatted labels with appropriate spacing
 */
const getOptimalMonthLabels = (dates: string[]): { index: number; label: string }[] => {
  const allMonthLabels = getMonthLabels(dates);
  
  if (allMonthLabels.length === 0) return [];
  
  const totalMonths = allMonthLabels.length;
  const interval = calculateLabelInterval(totalMonths);
  
  // Always include the first month, then every nth month based on interval
  const result: { index: number; label: string }[] = [];
  
  for (let i = 0; i < allMonthLabels.length; i += interval) {
    result.push(allMonthLabels[i]);
  }
  
  // Optionally add the last month if it's not already included
  // and there's significant gap (more than half the interval)
  const lastMonth = allMonthLabels[allMonthLabels.length - 1];
  const lastIncluded = result[result.length - 1];
  if (lastIncluded && lastMonth.index !== lastIncluded.index) {
    const monthsGap = allMonthLabels.length - 1 - allMonthLabels.indexOf(lastIncluded);
    if (monthsGap >= interval / 2) {
      result.push(lastMonth);
    }
  }
  
  return result;
};

const TimeSeriesContainer = ({ timeseries, latLon }: TimeSeriesContainerProps) => {
  const [tsData, setTsData] = useState<{ [key: number]: TimeSeriesRow[] } | null>(null);
  const [removeCloudy, setRemoveCloudy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Stabilize dependencies using primitive values to avoid unnecessary re-fetches
  const timeseriesIds = useMemo(() => timeseries.map(ts => ts.id).join(','), [timeseries]);
  const lat = latLon?.lat ?? null;
  const lon = latLon?.lon ?? null;

  useEffect(() => {
    if (lat === null || lon === null || timeseries.length === 0) {
      setTsData(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const fetchData = async () => {
      try {
        const timeseriesIds = timeseries.map(ts => ts.id);
        const data = await timeseriesCache.get(timeseriesIds, lat, lon);
        
        if (cancelled) return;

        setTsData(data);
      } catch (err) {
        console.error("Failed to load timeseries data", err);
        if (cancelled) return;
        setTsData(null);
      } finally {
        // Always set loading to false in finally to ensure it's updated
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [timeseriesIds, lat, lon, timeseries]);

  const chartData = useMemo(() => {
    if (!tsData) return null;

    // union of all timestamps
    const labelSet = new Set<string>();
    Object.values(tsData).forEach((rows) =>
      rows.forEach((r) => labelSet.add(r.time))
    );
    const labels = Array.from(labelSet).sort();
    
    // Get optimal month labels for x-axis based on data range
    const monthLabels = getOptimalMonthLabels(labels);

    // datasets (one per timeseries)
    const datasets = timeseries.map((ts, index) => {
      const rows = tsData[ts.id] ?? [];
      const rowMap = new Map(rows.map((r) => [r.time, r]));

      const color = COLORS[index % COLORS.length];

      return {
        label: ts.name,
        data: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return null;
          // If removing cloudy days, return null for cloud=1 (will be interpolated with spanGaps)
          if (removeCloudy && row.cloud === 1) return null;
          return row.values;
        }),
        borderColor: color,
        backgroundColor: color,
        // Show small red dots for cloudy days only when NOT removing them
        pointRadius: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return 0;
          // Show red dot for cloudy days when not removing them
          if (!removeCloudy && row.cloud === 1) return 1.5;
          return 0;
        }),
        pointBackgroundColor: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return color;
          return row.cloud === 1 ? "#ef4444" : color;
        }),
        pointBorderColor: labels.map((time) => {
          const row = rowMap.get(time);
          if (!row) return color;
          return row.cloud === 1 ? "#ef4444" : color;
        }),
        tension: 0.1,
        spanGaps: true, // Always interpolate between points
      };
    });

    return { labels, datasets, monthLabels };
  }, [tsData, timeseries, removeCloudy]);

  return (
    <div className="flex-1 flex flex-col bg-white p-2 min-h-0 overflow-hidden">
      <div className="flex justify-between items-center mb-1 flex-shrink-0 gap-2">
        {/* Legend */}
        <div className="flex items-center gap-2 flex-wrap">
          {timeseries.map((ts, index) => {
            const color = COLORS[index % COLORS.length];
            return (
              <div key={ts.id} className="flex items-center gap-1">
                <div 
                  className="w-2 h-2 rounded-sm" 
                  style={{ backgroundColor: color }}
                />
                <span className="text-[9px] font-bold text-neutral-700">
                  {ts.name}
                </span>
              </div>
            );
          })}
        </div>
        
        {/* Remove cloudy toggle */}
        <label className="flex items-center gap-1 cursor-pointer flex-shrink-0">
          <span className="text-[10px] text-neutral-600">
            Remove cloudy
          </span>
          <div 
            className={`relative w-6 h-3.5 rounded-full transition-colors ${removeCloudy ? 'bg-brand-500' : 'bg-neutral-300'}`}
            onClick={() => setRemoveCloudy(!removeCloudy)}
          >
            <div 
              className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${removeCloudy ? 'translate-x-3' : 'translate-x-0.5'}`}
            />
          </div>
        </label>
      </div>

      <div className="flex-1 min-h-0 w-full relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75 z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-neutral-300 border-t-brand-600"></div>
              <span className="text-[10px] text-neutral-600">Loading time series...</span>
            </div>
          </div>
        )}
        {chartData && (
          <Line
          data={chartData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: false, // Using custom HTML legend instead
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
            },
            scales: {
              x: {
                ticks: {
                  maxRotation: 45,
                  minRotation: 45,
                  font: { size: 8 },
                  callback: function(_value, index) {
                    // Only show labels at month boundaries
                    const monthLabel = chartData.monthLabels.find(m => m.index === index);
                    return monthLabel ? monthLabel.label : null;
                  },
                  autoSkip: false,
                },
                grid: {
                  display: false,
                },
              },
              y: {
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
        )}
      </div>
    </div>
  );
};

export default TimeSeriesContainer;
