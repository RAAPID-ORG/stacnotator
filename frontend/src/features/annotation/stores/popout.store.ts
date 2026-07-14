import { create } from 'zustand';
import type { Layout } from 'react-grid-layout';
import type { PopoutBounds } from '~/shared/ui/PopoutWindow';
import { appendItem, withoutKeys } from '../utils/popoutLayout';

/** Card size used when the sender cannot tell us how big the card was. */
export const FALLBACK_CARD_SIZE = { w: 20, h: 12 };

const FIRST_SCREEN_ID = 2; // the main browser window is screen 1

/** Secondary canvas screens: extra browser windows (one per monitor) that
 *  each host their own grid of canvas cards. Session scoped by design: the
 *  windows share the opener's JS context and cannot survive a reload, so
 *  persisting this state would only create orphan slots. */
interface PopoutState {
  /** Open screens, in creation order. Display name is "Screen <id>". */
  screens: number[];
  /** Which screen each sent-away card lives on. Cards not present are on
   *  the main canvas. */
  assignment: Record<string, number>;
  /** Grid layout per screen, same cols/rowHeight as the main canvas. */
  screenLayouts: Record<number, Layout>;
  /** Last known window bounds per screen, so a re-opened screen comes back
   *  where the user put it (best effort - browsers may clamp). */
  lastBounds: Record<number, PopoutBounds>;
  /** Move a card to a screen ('new' opens one), or back to main (null). */
  sendCard: (key: string, target: number | 'new' | null, size?: { w: number; h: number }) => void;
  /** Close a screen; all of its cards return to the main canvas. */
  closeScreen: (id: number) => void;
  setScreenLayout: (id: number, layout: Layout) => void;
  rememberBounds: (id: number, bounds: PopoutBounds) => void;
  closeAll: () => void;
}

export const usePopoutStore = create<PopoutState>((set) => ({
  screens: [],
  assignment: {},
  screenLayouts: {},
  lastBounds: {},

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
        return { assignment, screenLayouts: layouts };
      }

      const id =
        target === 'new'
          ? s.screens.reduce((max, sid) => Math.max(max, sid + 1), FIRST_SCREEN_ID)
          : target;
      if (target !== 'new' && !s.screens.includes(id)) return s;

      layouts[id] = appendItem(layouts[id] ?? [], key, size);
      return {
        screens: s.screens.includes(id) ? s.screens : [...s.screens, id],
        assignment: { ...s.assignment, [key]: id },
        screenLayouts: layouts,
      };
    }),

  closeScreen: (id) =>
    set((s) => {
      const assignment = Object.fromEntries(
        Object.entries(s.assignment).filter(([, sid]) => sid !== id)
      );
      const screenLayouts = { ...s.screenLayouts };
      delete screenLayouts[id];
      return { screens: s.screens.filter((sid) => sid !== id), assignment, screenLayouts };
    }),

  setScreenLayout: (id, layout) =>
    set((s) =>
      s.screens.includes(id) ? { screenLayouts: { ...s.screenLayouts, [id]: layout } } : s
    ),

  rememberBounds: (id, bounds) => set((s) => ({ lastBounds: { ...s.lastBounds, [id]: bounds } })),

  closeAll: () => set({ screens: [], assignment: {}, screenLayouts: {} }),
}));
