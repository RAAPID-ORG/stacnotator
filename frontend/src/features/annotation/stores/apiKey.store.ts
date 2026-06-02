import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ApiKeyStore {
  keys: Record<string, string>;
  setKey: (name: string, value: string) => void;
  clearKey: (name: string) => void;
}

export const useApiKeyStore = create<ApiKeyStore>()(
  persist(
    (set) => ({
      keys: {},
      setKey: (name, value) => set((s) => ({ keys: { ...s.keys, [name]: value } })),
      clearKey: (name) =>
        set((s) => {
          const next = { ...s.keys };
          delete next[name];
          return { keys: next };
        }),
    }),
    {
      name: 'stacnotator:api-keys',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
