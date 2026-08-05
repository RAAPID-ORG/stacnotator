import { create } from 'zustand';
import { listOrganizations, type OrganizationOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';

/** The viewer's organizations, shared by every consumer so a list that changes
 *  in one place (a new organization, a renamed one) is visible everywhere -
 *  the sidebar switcher outlives ordinary navigation and would otherwise keep
 *  showing whatever it fetched on the first render of the session. */
interface OrganizationsState {
  items: OrganizationOut[];
  /** True until the first fetch settles, and while a fetch is in flight. */
  loading: boolean;
  /** Set once a fetch succeeds. A failure leaves it false so the next consumer retries. */
  loaded: boolean;
  /** Message from the last failed fetch, cleared by the next successful one. Lets
   *  consumers tell "the list is empty" from "we never got the list". */
  error: string | null;
  inFlight: Promise<void> | null;
  /** Fetches once; later callers join the in-flight fetch or get the loaded list. */
  ensureLoaded: () => Promise<void>;
  /** Always refetches, queued behind an in-flight fetch so responses cannot
   *  land out of order. Resolves once the store holds the fresh list. */
  refresh: () => Promise<void>;
  /** Drops everything identity-scoped, so the next viewer starts from an empty
   *  list rather than the previous one's organizations. */
  reset: () => void;
}

const EMPTY = {
  items: [] as OrganizationOut[],
  loading: true,
  loaded: false,
  error: null,
  inFlight: null,
};

export const useOrganizationsStore = create<OrganizationsState>((set, get) => {
  const fetchList = async () => {
    set({ loading: true });
    try {
      const { data } = await listOrganizations();
      set({ items: data?.items ?? [], loaded: true, error: null });
    } catch (err) {
      set({ error: handleError(err, 'Failed to load organizations', { showUser: false }) });
    } finally {
      set({ loading: false });
    }
  };

  const enqueueFetch = () => {
    const request = (get().inFlight ?? Promise.resolve()).then(fetchList);
    set({ inFlight: request });
    void request.finally(() => {
      if (get().inFlight === request) set({ inFlight: null });
    });
    return request;
  };

  return {
    ...EMPTY,

    ensureLoaded: () => {
      const { loaded, inFlight } = get();
      if (loaded) return Promise.resolve();
      return inFlight ?? enqueueFetch();
    },

    refresh: enqueueFetch,

    reset: () => set(EMPTY),
  };
});
