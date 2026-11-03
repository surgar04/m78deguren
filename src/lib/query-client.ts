import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { recordException } from './diagnostics';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => recordException(error, 'query.failed') }),
  mutationCache: new MutationCache({
    onError: (error) => recordException(error, 'mutation.failed'),
  }),
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
