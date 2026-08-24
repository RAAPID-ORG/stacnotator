import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * Renders a component that reads or writes through react-query. Each call gets
 * its own cache so nothing leaks between tests; retries are off and there is no
 * garbage-collection delay, so what the component asked for is what the
 * assertions see.
 *
 * The queries themselves are mocked at `~/api/client/sdk.gen`, which is the
 * module the generated query options call - mocking `~/api/client` only
 * intercepts direct SDK callers.
 */
export const renderWithQuery = (ui: ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};
