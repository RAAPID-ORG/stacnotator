import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LabelStyle } from '../campaign/labelStyle';
import type { LegendOverride } from '../campaign/renderConfig';

export type PreloadTier = 'auto' | 'off' | 'conservative' | 'balanced' | 'heavy';

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

  setPreloadTier: (tier: PreloadTier) => void;
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

      setPreloadTier: (preloadTier) => set({ preloadTier }),
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
