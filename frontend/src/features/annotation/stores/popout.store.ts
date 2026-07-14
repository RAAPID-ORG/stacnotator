import { create } from 'zustand';
import type { PopoutBounds } from '~/shared/ui/PopoutWindow';

/** Which canvas cards currently live in their own browser window. Session
 *  scoped by design: pop-out windows share the opener's JS context and cannot
 *  survive a reload, so persisting this state would only create orphan slots. */
interface PopoutState {
  poppedKeys: string[];
  /** Last known window bounds per card, so re-popping a card brings its
   *  window back where the user put it (best effort - browsers may clamp). */
  lastBounds: Record<string, PopoutBounds>;
  popOut: (key: string) => void;
  closePopout: (key: string) => void;
  rememberBounds: (key: string, bounds: PopoutBounds) => void;
  closeAll: () => void;
}

export const usePopoutStore = create<PopoutState>((set) => ({
  poppedKeys: [],
  lastBounds: {},

  popOut: (key) =>
    set((s) => (s.poppedKeys.includes(key) ? s : { poppedKeys: [...s.poppedKeys, key] })),

  closePopout: (key) => set((s) => ({ poppedKeys: s.poppedKeys.filter((k) => k !== key) })),

  rememberBounds: (key, bounds) => set((s) => ({ lastBounds: { ...s.lastBounds, [key]: bounds } })),

  closeAll: () => set({ poppedKeys: [] }),
}));
