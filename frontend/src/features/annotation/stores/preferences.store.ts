import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  setStyleOverride,
  clearStyleOverride,
  type LabelStyle,
  type StyleOverrides,
} from '../utils/annotationStyle';
import type { RenderOverride } from '../utils/customMapOverride';

/**
 * Per-device user preferences. Persisted to localStorage via zustand's
 * `persist` middleware so values survive reloads, route changes, and
 * tab switches. This is the home for any setting the user should not
 * have to re-pick every session (preload tier, future: default zoom,
 * theme, etc.).
 *
 * Scope is per-device, not per-account: each browser/profile has its own
 * preferences. Anything that should sync across the user's devices belongs
 * on the backend instead.
 *
 * Add new preferences here as additional fields; they will be persisted
 * automatically. Use `partialize` if some store fields should stay
 * ephemeral.
 */

export type PreloadMode = 'auto' | 'off' | 'conservative' | 'balanced' | 'heavy';

interface PreferencesStore {
  preloadMode: PreloadMode;
  setPreloadMode: (mode: PreloadMode) => void;

  /**
   * Per-view choice of which collection becomes active when navigating to a new
   * task. Key = view id, value = collection id. An absent entry means "use the
   * view's first window collection" (the default). Pass `null` to clear.
   */
  taskStartCollectionByView: Record<number, number>;
  setTaskStartCollection: (viewId: number, collectionId: number | null) => void;

  /**
   * Sparse map of (account, campaign) pairs the user has already dismissed
   * the guided tour for. Key format: `${accountId}:${campaignId}`. Absent
   * key means "not seen". Read via `hasSeenTour` (which also migrates from
   * the legacy per-key localStorage entries).
   */
  tourSeenByCampaign: Record<string, true>;
  markTourSeen: (accountId: string, campaignId: number) => void;

  /**
   * Per-user styling for drawn objects in open mode, keyed by
   * `${campaignId}:${labelId}`. Only fields the user changed are stored; the
   * rest fall back to the label default via `resolveLabelStyle`. Merge/keying
   * logic lives in `utils/annotationStyle.ts` (pure, unit-tested).
   */
  annotationStyles: StyleOverrides;
  setLabelStyle: (campaignId: number, labelId: number, patch: Partial<LabelStyle>) => void;
  resetLabelStyle: (campaignId: number, labelId: number) => void;

  /**
   * Per-user colour tweaks to custom map overlays, keyed by map id (a global PK).
   * An absent entry means "render with the campaign's config". Kept until the user
   * resets it, so an admin editing the campaign config does not silently discard a
   * deliberate local choice. Merge logic lives in `utils/customMapOverride.ts`.
   */
  customMapOverrides: Record<number, RenderOverride>;
  setCustomMapOverride: (mapId: number, patch: RenderOverride) => void;
  resetCustomMapOverride: (mapId: number) => void;
}

const tourKey = (accountId: string, campaignId: number) => `${accountId}:${campaignId}`;

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      preloadMode: 'auto',
      setPreloadMode: (mode) => set({ preloadMode: mode }),

      taskStartCollectionByView: {},
      setTaskStartCollection: (viewId, collectionId) =>
        set((s) => {
          const next = { ...s.taskStartCollectionByView };
          if (collectionId === null) delete next[viewId];
          else next[viewId] = collectionId;
          return { taskStartCollectionByView: next };
        }),

      tourSeenByCampaign: {},
      markTourSeen: (accountId, campaignId) =>
        set((s) => ({
          tourSeenByCampaign: {
            ...s.tourSeenByCampaign,
            [tourKey(accountId, campaignId)]: true,
          },
        })),

      annotationStyles: {},
      setLabelStyle: (campaignId, labelId, patch) =>
        set((s) => ({
          annotationStyles: setStyleOverride(s.annotationStyles, campaignId, labelId, patch),
        })),
      resetLabelStyle: (campaignId, labelId) =>
        set((s) => ({
          annotationStyles: clearStyleOverride(s.annotationStyles, campaignId, labelId),
        })),

      customMapOverrides: {},
      setCustomMapOverride: (mapId, patch) =>
        set((s) => ({
          customMapOverrides: {
            ...s.customMapOverrides,
            [mapId]: { ...s.customMapOverrides[mapId], ...patch },
          },
        })),
      resetCustomMapOverride: (mapId) =>
        set((s) => {
          const next = { ...s.customMapOverrides };
          delete next[mapId];
          return { customMapOverrides: next };
        }),
    }),
    {
      name: 'stacnotator:preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/**
 * Has the user already dismissed the guided tour for this campaign?
 *
 * Returns true when the account is unknown (fail-safe: don't auto-open the
 * tour if we can't identify the user).
 */
export function hasSeenTour(accountId: string | undefined, campaignId: number): boolean {
  if (!accountId) return true;
  return !!usePreferencesStore.getState().tourSeenByCampaign[tourKey(accountId, campaignId)];
}
