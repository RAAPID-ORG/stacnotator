import { create } from 'zustand';
import { me, type UserOutDetailed } from 'src/api/client';
import { extractErrorMessage } from '~/shared/utils/errorHandler';

type AccountState = {
  account: UserOutDetailed | null;
  loading: boolean;
  error: string | null;
  emailNotVerified: boolean;
  fetchAccount: () => Promise<void>;
  clear: () => void;
};

export const useAccountStore = create<AccountState>((set) => ({
  account: null,
  loading: false,
  error: null,
  emailNotVerified: false,

  fetchAccount: async () => {
    set({ loading: true, error: null, emailNotVerified: false });
    try {
      const { data } = await me();
      set({ account: data, loading: false });
    } catch (e) {
      set({ loading: false, error: extractErrorMessage(e, 'Failed to load account') });
    }
  },

  clear: () => set({ account: null, loading: false, error: null, emailNotVerified: false }),
}));
