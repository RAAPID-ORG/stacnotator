import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { handleError } from '~/shared/utils/errorHandler';

/** What every query and mutation says about its own failure. The caches report
 *  it, so no call site needs a try/catch to put a message on screen. */
export type RequestMeta = {
  /** Log label, and the toast text when the error carries no message of its own. */
  errorMessage: string;
  /** False where the failure is shown by someone other than the cache. */
  showUser?: boolean;
};

/** For a mutation whose caller awaits it and reports the failure itself: the
 *  admin tables and the assignment modals keep their own row and form state on
 *  a failure, so a toast from here would be the second one. */
export const reportedByCaller = (errorMessage: string): RequestMeta => ({
  errorMessage,
  showUser: false,
});

/** For lists other people change while you are looking at them - task progress,
 *  the review list, campaign statistics. Every mount re-reads, and coming back
 *  to the tab counts as asking whether it is still current.
 *
 *  Not a timer: these endpoints return a campaign's whole task or annotation
 *  list, which is too much to re-send on a schedule for a page someone leaves
 *  open. The annotation page, where freshness has to be immediate, does not use
 *  this at all - it syncs deltas against a cursor (`stores/work.ts`). */
export const SHARED_WORK = {
  staleTime: 0,
  refetchOnWindowFocus: true,
} as const;

/** react-query types `meta` as an open record, so the contract above is checked
 *  where it is written rather than where it is read. */
const report = (error: unknown, meta: Record<string, unknown> | undefined) => {
  const context = typeof meta?.errorMessage === 'string' ? meta.errorMessage : 'Request failed';
  handleError(error, context, { showUser: meta?.showUser !== false });
};

/** Retries are off: our failures are HTTP 4xx from our own API far more often
 *  than blips, so retrying only delays the message - and it keeps tests
 *  deterministic, one mocked route per request. Refetch-on-focus is off by
 *  default and opted into by `SHARED_WORK`, so a long-lived annotation tab does
 *  not restorm the API every time the window is touched. `staleTime` is what
 *  makes navigating back to a page instant while still re-asking once the data
 *  has had time to move. */
export const createQueryClient = () =>
  new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => report(error, query.meta) }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => report(error, mutation.meta),
    }),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });

export const queryClient = createQueryClient();
