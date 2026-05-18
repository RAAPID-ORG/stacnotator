import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
   * Sparse map of (account, campaign) pairs the user has already dismissed
   * the guided tour for. Key format: `${accountId}:${campaignId}`. Absent
   * key means "not seen". Read via `hasSeenTour` (which also migrates from
   * the legacy per-key localStorage entries).
   */
  tourSeenByCampaign: Record<string, true>;
  markTourSeen: (accountId: string, campaignId: number) => void;
}

const tourKey = (accountId: string, campaignId: number) => `${accountId}:${campaignId}`;

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      preloadMode: 'auto',
      setPreloadMode: (mode) => set({ preloadMode: mode }),

      tourSeenByCampaign: {},
      markTourSeen: (accountId, campaignId) =>
        set((s) => ({
          tourSeenByCampaign: {
            ...s.tourSeenByCampaign,
            [tourKey(accountId, campaignId)]: true,
          },
        })),
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
 * tour if we can't identify the user). On a miss, also probes the legacy
 * `stacnotator:tour-seen:<accountId>:<campaignId>` key written by earlier
 * versions and folds it into the store, so upgrading users don't see the
 * tour again. The legacy key is removed once migrated.
 */
export function hasSeenTour(accountId: string | undefined, campaignId: number): boolean {
  if (!accountId) return true;
  const key = tourKey(accountId, campaignId);
  if (usePreferencesStore.getState().tourSeenByCampaign[key]) return true;
  try {
    const legacy = `stacnotator:tour-seen:${accountId}:${campaignId}`;
    if (localStorage.getItem(legacy) === '1') {
      usePreferencesStore.getState().markTourSeen(accountId, campaignId);
      localStorage.removeItem(legacy);
      return true;
    }
  } catch {
    // localStorage unavailable (private browsing etc.) - treat as not seen
  }
  return false;
}
