import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { handleError } from '~/shared/utils/errorHandler';

/** Every query and mutation carries `meta: { errorMessage, showUser? }`, which
 *  is how failures get reported here instead of in a try/catch at each call
 *  site. `showUser: false` is for the surfaces that render the failure
 *  themselves. Read defensively because react-query types `meta` open. */
const report = (error: unknown, meta: Record<string, unknown> | undefined) => {
  const context = typeof meta?.errorMessage === 'string' ? meta.errorMessage : 'Request failed';
  handleError(error, context, { showUser: meta?.showUser !== false });
};

/** Retries are off: our failures are HTTP 4xx from our own API far more often
 *  than blips, so retrying only delays the message - and it keeps tests
 *  deterministic, one mocked route per request. Refetch-on-focus is off for the
 *  same reason, plus a long-lived annotation tab should not restorm the API
 *  every time the window is touched. `staleTime` is what makes navigating back
 *  to a page instant while still re-asking when the data has had time to move. */
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
