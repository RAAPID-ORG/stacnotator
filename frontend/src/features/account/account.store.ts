import { create } from 'zustand';
import { me, type UserOutDetailed } from 'src/api/client';

type AccountState = {
  account: UserOutDetailed | null;
  loading: boolean;
  error: string | null;
  fetchAccount: () => Promise<void>;
  clear: () => void;
};

export const useAccountStore = create<AccountState>((set) => ({
  account: null,
  loading: false,
  error: null,

  fetchAccount: async () => {
    set({ loading: true, error: null });
    try {
      const { data } = await me();
      if (!data) throw new Error('No user data returned');
      set({ account: data, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load account' });
    }
  },

  clear: () => set({ account: null, loading: false, error: null }),
}));
