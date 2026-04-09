import { create } from 'zustand';
import { me, type UserOutDetailed } from 'src/api/client';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await me();

      // hey-api returns { error, request, response } on failure
      // and { data, request, response } on success
      if (result.error) {
        const detail = result.error?.detail;
        if (detail === 'email_not_verified') {
          set({ loading: false, emailNotVerified: true });
          return;
        }
        throw new Error(detail || 'Failed to load account');
      }

      if (!result.data) throw new Error('No user data returned');
      set({ account: result.data as UserOutDetailed, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load account',
      });
    }
  },

  clear: () => set({ account: null, loading: false, error: null, emailNotVerified: false }),
}));
