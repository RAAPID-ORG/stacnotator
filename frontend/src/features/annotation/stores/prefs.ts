import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LabelStyle } from '~/features/annotation/core/annotation';
import type { LegendOverride } from '~/features/annotation/core/catalog';

export type PreloadTier = 'auto' | 'off' | 'conservative' | 'balanced' | 'heavy';
export type LabelStyleOverride = Partial<LabelStyle>;

export interface PrefsState {
  preloadTier: PreloadTier;
  /** Per-view choice of which collection becomes active on task navigation.
   *  Key = view id, value = collection id. Absent = "use the default". */
  pinnedStart: Record<number, number>;
  /** Ids of guided tours already dismissed. */
  toursSeen: string[];
  labelStyles: Record<number, LabelStyleOverride>;
  legendOverrides: Record<number, LegendOverride>;

  setPreloadTier: (tier: PreloadTier) => void;
  /** Pass `collectionId: null` to clear the pin for that view. */
  setPinnedStart: (viewId: number, collectionId: number | null) => void;
  markTourSeen: (tourId: string) => void;
  setLabelStyle: (labelId: number, patch: LabelStyleOverride) => void;
  resetLabelStyle: (labelId: number) => void;
  setLegendOverride: (id: number, override: LegendOverride) => void;
  resetLegendOverride: (id: number) => void;
}

const initialPrefs = {
  preloadTier: 'auto' as PreloadTier,
  pinnedStart: {} as Record<number, number>,
  toursSeen: [] as string[],
  labelStyles: {} as Record<number, LabelStyleOverride>,
  legendOverrides: {} as Record<number, LegendOverride>,
};

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      ...initialPrefs,

      setPreloadTier: (preloadTier) => set({ preloadTier }),

      setPinnedStart: (viewId, collectionId) =>
        set((s) => {
          const next = { ...s.pinnedStart };
          if (collectionId === null) delete next[viewId];
          else next[viewId] = collectionId;
          return { pinnedStart: next };
        }),

      markTourSeen: (tourId) =>
        set((s) => (s.toursSeen.includes(tourId) ? s : { toursSeen: [...s.toursSeen, tourId] })),

      setLabelStyle: (labelId, patch) =>
        set((s) => ({
          labelStyles: { ...s.labelStyles, [labelId]: { ...s.labelStyles[labelId], ...patch } },
        })),

      resetLabelStyle: (labelId) =>
        set((s) => {
          if (!(labelId in s.labelStyles)) return s;
          const next = { ...s.labelStyles };
          delete next[labelId];
          return { labelStyles: next };
        }),

      setLegendOverride: (id, override) =>
        set((s) => ({ legendOverrides: { ...s.legendOverrides, [id]: override } })),

      resetLegendOverride: (id) =>
        set((s) => {
          if (!(id in s.legendOverrides)) return s;
          const next = { ...s.legendOverrides };
          delete next[id];
          return { legendOverrides: next };
        }),
    }),
    {
      name: 'annotation:prefs',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        preloadTier: s.preloadTier,
        pinnedStart: s.pinnedStart,
        toursSeen: s.toursSeen,
        labelStyles: s.labelStyles,
        legendOverrides: s.legendOverrides,
      }),
    }
  )
);
