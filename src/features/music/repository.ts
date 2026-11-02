import { useQuery } from '@tanstack/react-query';
import { isDesktop, executeMusic } from '@/lib/desktop';
import {
  musicLocalLibrarySchema,
  musicAccountSchema,
  type OnlineMusicProvider,
} from '@/lib/music-contracts';
import { musicEngine } from './engine';

export function useLocalMusic() {
  return useQuery({
    queryKey: ['music', 'local'],
    queryFn: () => executeMusic({ operation: 'local-list' }, musicLocalLibrarySchema),
    enabled: isDesktop(),
    refetchInterval: (query) => (query.state.data?.importing ? 1000 : false),
  });
}
export function useMusicAccount(provider: OnlineMusicProvider) {
  return useQuery({
    queryKey: ['music', 'account', provider],
    queryFn: () => musicEngine('account', [provider], musicAccountSchema),
    enabled: isDesktop(),
    staleTime: 60000,
    retry: false,
  });
}
