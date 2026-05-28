import { create } from 'zustand';
import { type CustomMap, listCustomMaps } from '~/api/customMaps';

interface OverlayState {
  campaignId: number | null;
  customMaps: CustomMap[];
  loading: boolean;
  activeId: string | null;
  load: (campaignId: number) => Promise<void>;
  refresh: () => Promise<void>;
  setActive: (customMapId: string | null) => void;
  /** Cycle: none → first → second → … → last → none. */
  cycleActive: () => void;
  reset: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  campaignId: null,
  customMaps: [],
  loading: false,
  activeId: null,

  load: async (campaignId) => {
    if (get().campaignId === campaignId && get().customMaps.length > 0) {
      get().refresh();
      return;
    }
    set({ campaignId, loading: true, customMaps: [], activeId: null });
    try {
      const { data } = await listCustomMaps(campaignId);
      set({ customMaps: data ?? [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  refresh: async () => {
    const { campaignId } = get();
    if (!campaignId) return;
    try {
      const { data } = await listCustomMaps(campaignId);
      if (data) set({ customMaps: data });
    } catch {
      // silent — map UI shouldn't error-toast on background polls
    }
  },

  setActive: (customMapId) => set({ activeId: customMapId }),

  cycleActive: () => {
    const { customMaps, activeId } = get();
    const ready = customMaps.filter((m) => m.status === 'ready');
    if (ready.length === 0) return;
    if (activeId === null) {
      set({ activeId: ready[0].id });
      return;
    }
    const idx = ready.findIndex((m) => m.id === activeId);
    set({ activeId: idx === -1 || idx === ready.length - 1 ? null : ready[idx + 1].id });
  },

  reset: () => set({ campaignId: null, customMaps: [], activeId: null }),
}));
