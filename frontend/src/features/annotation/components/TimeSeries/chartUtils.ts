/**
 * Utility functions for formatting and processing time series data for chart display
 */

/**
 * Format date string to "MMM 'YY" format
 * Handles both YYYYMMDD and ISO date formats
 */
export const formatDateLabel = (dateStr: string): string => {
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

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
export const formatDateForTooltip = (dateStr: string): string => {
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

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
  if (totalMonths <= 6) return 1; // 6 months or less: show every month
  if (totalMonths <= 12) return 2; // 7-12 months: show every 2 months
  if (totalMonths <= 18) return 3; // 13-18 months: show every 3 months
  if (totalMonths <= 24) return 4; // 19-24 months: show every 4 months
  if (totalMonths <= 36) return 6; // 25-36 months: show every 6 months
  return 12; // More than 36 months: show every year
};

/**
 * Get optimally spaced month labels based on data range
 * Returns indices and formatted labels with appropriate spacing
 */
export const getOptimalMonthLabels = (dates: string[]): { index: number; label: string }[] => {
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
    const lastIncludedIdx = allMonthLabels.findIndex((m) => m.index === lastIncluded.index);
    const monthsGap = allMonthLabels.length - 1 - lastIncludedIdx;
    if (monthsGap >= interval / 2) {
      result.push(lastMonth);
    }
  }

  return result;
};
