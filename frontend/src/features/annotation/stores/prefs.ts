import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LabelStyle } from '../campaign/labelStyle';
import type { LegendOverride } from '~/shared/imagery/tileColors';

export type PreloadTier = 'auto' | 'off' | 'conservative' | 'balanced' | 'heavy';

export interface SmoothingOptions {
  window: number;
  order: number;
}

/** How the timeseries chart is drawn. Held here rather than in the chart
 *  because the panel drops back to a spinner while a new location loads, which
 *  unmounts the chart - so anything kept in its own state would reset on every
 *  task change. */
export interface TimeseriesChartOptions {
  removeCloudy: boolean;
  showDots: boolean;
  smoothEnabled: boolean;
  smoothing: SmoothingOptions;
}

const DEFAULT_TIMESERIES_CHART: TimeseriesChartOptions = {
  removeCloudy: true,
  showDots: true,
  smoothEnabled: false,
  smoothing: { window: 7, order: 3 },
};

interface PrefsState {
  preloadTier: PreloadTier;
  /** Whether Skip may proceed without asking. */
  skipConfirmDisabled: boolean;
  /** Which collection becomes active on task navigation, per view. Absent
   *  means "use the default". */
  pinnedStart: Record<number, number>;
  /** Ids of guided tours already dismissed. */
  toursSeen: string[];
  labelStyles: Record<number, Partial<LabelStyle>>;
  legendOverrides: Record<number, LegendOverride>;
  timeseriesChart: TimeseriesChartOptions;

  setPreloadTier: (tier: PreloadTier) => void;
  setTimeseriesChart: (patch: Partial<TimeseriesChartOptions>) => void;
  setSkipConfirmDisabled: (disabled: boolean) => void;
  /** `null` clears the pin for that view. */
  setPinnedStart: (viewId: number, collectionId: number | null) => void;
  markTourSeen: (tourId: string) => void;
  setLabelStyle: (labelId: number, patch: Partial<LabelStyle>) => void;
  resetLabelStyle: (labelId: number) => void;
  setLegendOverride: (id: number, override: LegendOverride) => void;
  resetLegendOverride: (id: number) => void;
}

function omit<T>(record: Record<number, T>, key: number): Record<number, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      preloadTier: 'auto',
      skipConfirmDisabled: false,
      pinnedStart: {},
      toursSeen: [],
      labelStyles: {},
      legendOverrides: {},
      timeseriesChart: DEFAULT_TIMESERIES_CHART,

      setPreloadTier: (preloadTier) => set({ preloadTier }),
      setTimeseriesChart: (patch) =>
        set((s) => ({ timeseriesChart: { ...s.timeseriesChart, ...patch } })),
      setSkipConfirmDisabled: (skipConfirmDisabled) => set({ skipConfirmDisabled }),

      setPinnedStart: (viewId, collectionId) =>
        set((s) => ({
          pinnedStart:
            collectionId === null
              ? omit(s.pinnedStart, viewId)
              : { ...s.pinnedStart, [viewId]: collectionId },
        })),

      markTourSeen: (tourId) =>
        set((s) => (s.toursSeen.includes(tourId) ? s : { toursSeen: [...s.toursSeen, tourId] })),

      setLabelStyle: (labelId, patch) =>
        set((s) => ({
          labelStyles: { ...s.labelStyles, [labelId]: { ...s.labelStyles[labelId], ...patch } },
        })),

      resetLabelStyle: (labelId) => set((s) => ({ labelStyles: omit(s.labelStyles, labelId) })),
      setLegendOverride: (id, override) =>
        set((s) => ({ legendOverrides: { ...s.legendOverrides, [id]: override } })),
      resetLegendOverride: (id) => set((s) => ({ legendOverrides: omit(s.legendOverrides, id) })),
    }),
    { name: 'annotation:prefs', storage: createJSONStorage(() => localStorage) }
  )
);
