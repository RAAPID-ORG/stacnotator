import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Layout } from 'react-grid-layout';
import type { PopoutBounds } from '~/shared/ui/PopoutWindow';
import { appendItem, withoutKeys } from '../utils/popoutLayout';

/** Card size used when the sender cannot tell us how big the card was. */
export const FALLBACK_CARD_SIZE = { w: 20, h: 12 };

const FIRST_SCREEN_ID = 2; // the main browser window is screen 1

interface ScreensSnapshot {
  screens: number[];
  assignment: Record<string, number>;
  screenLayouts: Record<number, Layout>;
  lastBounds: Record<number, PopoutBounds>;
}

/** Secondary canvas screens: extra browser windows (one per monitor) that
 *  each host their own grid of canvas cards.
 *
 *  Runtime state (open windows) cannot survive a reload - popups share the
 *  opener's JS context - so the *configuration* is persisted per
 *  user+campaign in `saved` (localStorage) and every runtime mutation writes
 *  through to it. After a reload the user restores the split with one click
 *  (browsers require a user gesture to open windows). */
interface PopoutState extends ScreensSnapshot {
  /** Live inner canvas width per open screen, so cards sent there can be
   *  converted to grid units that keep their pixel size. Runtime only. */
  screenWidths: Record<number, number>;
  setScreenWidth: (id: number, width: number) => void;
  /** `${userId}:${campaignId}` while an annotation canvas is mounted. */
  activeKey: string | null;
  /** Persisted screen configuration per user+campaign. */
  saved: Record<string, ScreensSnapshot>;
  setActiveKey: (key: string | null) => void;
  /** Move a card to a screen ('new' opens one), or back to main (null). */
  sendCard: (key: string, target: number | 'new' | null, size?: { w: number; h: number }) => void;
  /** Close a screen; all of its cards return to the main canvas. Deliberate
   *  closes write through to `saved` - the opener-unload path must NOT call
   *  this, or quitting the app would wipe the saved split. */
  closeScreen: (id: number) => void;
  setScreenLayout: (id: number, layout: Layout) => void;
  rememberBounds: (id: number, bounds: PopoutBounds) => void;
  /** Re-open the saved configuration for the active key. */
  restoreSaved: () => void;
  /** Forget the saved configuration for the active key. */
  clearSaved: () => void;
  /** Leave the annotation page: close windows, keep `saved` untouched. */
  reset: () => void;
}

const snapshot = (s: ScreensSnapshot): ScreensSnapshot => ({
  screens: s.screens,
  assignment: s.assignment,
  screenLayouts: s.screenLayouts,
  lastBounds: s.lastBounds,
});

/** Apply a runtime patch and mirror the resulting snapshot into `saved`. */
function withSaved(s: PopoutState, patch: Partial<ScreensSnapshot>): Partial<PopoutState> {
  if (!s.activeKey) return patch;
  return {
    ...patch,
    saved: { ...s.saved, [s.activeKey]: snapshot({ ...snapshot(s), ...patch }) },
  };
}

export const usePopoutStore = create<PopoutState>()(
  persist(
    (set) => ({
      screens: [],
      assignment: {},
      screenLayouts: {},
      lastBounds: {},
      screenWidths: {},
      activeKey: null,
      saved: {},

      setActiveKey: (key) => set({ activeKey: key }),

      setScreenWidth: (id, width) =>
        set((s) => ({ screenWidths: { ...s.screenWidths, [id]: width } })),

      sendCard: (key, target, size = FALLBACK_CARD_SIZE) =>
        set((s) => {
          const from = s.assignment[key];
          const layouts = { ...s.screenLayouts };
          if (from != null && layouts[from]) {
            layouts[from] = withoutKeys(layouts[from], new Set([key]));
          }

          if (target === null) {
            const assignment = { ...s.assignment };
            delete assignment[key];
            return withSaved(s, { assignment, screenLayouts: layouts });
          }

          const id =
            target === 'new'
              ? s.screens.reduce((max, sid) => Math.max(max, sid + 1), FIRST_SCREEN_ID)
              : target;
          if (target !== 'new' && !s.screens.includes(id)) return s;

          layouts[id] = appendItem(layouts[id] ?? [], key, size);
          return withSaved(s, {
            screens: s.screens.includes(id) ? s.screens : [...s.screens, id],
            assignment: { ...s.assignment, [key]: id },
            screenLayouts: layouts,
          });
        }),

      closeScreen: (id) =>
        set((s) => {
          const assignment = Object.fromEntries(
            Object.entries(s.assignment).filter(([, sid]) => sid !== id)
          );
          const screenLayouts = { ...s.screenLayouts };
          delete screenLayouts[id];
          const screenWidths = { ...s.screenWidths };
          delete screenWidths[id];
          return {
            ...withSaved(s, {
              screens: s.screens.filter((sid) => sid !== id),
              assignment,
              screenLayouts,
            }),
            screenWidths,
          };
        }),

      setScreenLayout: (id, layout) =>
        set((s) =>
          s.screens.includes(id)
            ? withSaved(s, { screenLayouts: { ...s.screenLayouts, [id]: layout } })
            : s
        ),

      rememberBounds: (id, bounds) =>
        set((s) => withSaved(s, { lastBounds: { ...s.lastBounds, [id]: bounds } })),

      restoreSaved: () =>
        set((s) => {
          const snap = s.activeKey ? s.saved[s.activeKey] : undefined;
          if (!snap) return s;
          return {
            screens: [...snap.screens],
            assignment: { ...snap.assignment },
            screenLayouts: { ...snap.screenLayouts },
            lastBounds: { ...snap.lastBounds },
          };
        }),

      clearSaved: () =>
        set((s) => {
          if (!s.activeKey) return s;
          const saved = { ...s.saved };
          delete saved[s.activeKey];
          return { saved };
        }),

      reset: () =>
        set({
          activeKey: null,
          screens: [],
          assignment: {},
          screenLayouts: {},
          lastBounds: {},
          screenWidths: {},
        }),
    }),
    {
      name: 'annotation-screens',
      partialize: (s) => ({ saved: s.saved }),
    }
  )
);
