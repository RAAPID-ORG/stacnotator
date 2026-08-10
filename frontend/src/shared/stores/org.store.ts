import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The organization the user is currently working in. Persisted per device so
 *  the choice survives reloads. `hasChosenOrg` separates a deliberate
 *  "No organization" pick from a first run that never chose - only the former
 *  is honored by reconciliation. */
interface OrgState {
  activeOrgId: number | null;
  hasChosenOrg: boolean;
  setActiveOrgId: (id: number | null) => void;
  /** Clears the persisted choice: it belongs to the signed-in user, not the
   *  device. Also drops the chosen marker so the next login re-defaults. */
  reset: () => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      activeOrgId: null,
      hasChosenOrg: false,
      setActiveOrgId: (id) => set({ activeOrgId: id, hasChosenOrg: true }),
      reset: () => set({ activeOrgId: null, hasChosenOrg: false }),
    }),
    { name: 'active-org' }
  )
);
