import { useQuery } from '@tanstack/react-query';
import { isDesktop, executeMusic } from '@/lib/desktop';
import {
  musicLocalLibrarySchema,
  musicAccountSchema,
  onlineMusicProviderSchema,
  type MusicProvider,
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
export function useMusicAccount(provider: MusicProvider) {
  return useQuery({
    queryKey: ['music', 'account', provider],
    queryFn: () =>
      musicEngine('account', [onlineMusicProviderSchema.parse(provider)], musicAccountSchema),
    enabled: isDesktop() && provider !== 'local',
    staleTime: 60000,
    retry: false,
  });
}
