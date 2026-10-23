import { create } from 'zustand';
import { me, type MeOut } from '~/api/client';
import i18n from '~/shared/i18n';
import { extractErrorMessage } from '~/shared/utils/errorHandler';

const t = i18n.getFixedT(null, 'common');

type AccountState = {
  account: MeOut | null;
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
      set({ loading: false, error: extractErrorMessage(e, t('errors.loadAccount')) });
    }
  },

  clear: () => set({ account: null, loading: false, error: null, emailNotVerified: false }),
}));
