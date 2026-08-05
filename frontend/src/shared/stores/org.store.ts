import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The organization the user is currently working in. Persisted per device so
 *  the choice survives reloads. */
interface OrgState {
  activeOrgId: number | null;
  setActiveOrgId: (id: number | null) => void;
  /** Clears the persisted choice: it belongs to the signed-in user, not the device. */
  reset: () => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      activeOrgId: null,
      setActiveOrgId: (id) => set({ activeOrgId: id }),
      reset: () => set({ activeOrgId: null }),
    }),
    { name: 'active-org' }
  )
);
