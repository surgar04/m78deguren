import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { executeQuickLaunch, executeOtherGames, executeHome, isDesktop } from '@/lib/desktop';
import {
  quickSnapshotSchema,
  otherGamesSchema,
  gameProfileSchema,
  type QuickRequest,
  type GamesRequest,
} from '@/lib/launcher-contracts';
import { HOME_KEY } from '@/features/home/repository';
export const QUICK_KEY = ['quick-launch', 'snapshot'] as const;
export const OTHER_KEY = ['other-games', 'snapshot'] as const;
export function useQuickLaunch() {
  return useQuery({
    queryKey: QUICK_KEY,
    queryFn: () => executeQuickLaunch({ operation: 'snapshot' }, quickSnapshotSchema),
    enabled: isDesktop(),
    staleTime: 10000,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
export function useQuickAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: QuickRequest) => executeQuickLaunch(request, schema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: QUICK_KEY });
      void client.invalidateQueries({ queryKey: HOME_KEY });
    },
  });
}
export function useOtherGames() {
  return useQuery({
    queryKey: OTHER_KEY,
    queryFn: () => executeOtherGames({ operation: 'snapshot' }, otherGamesSchema),
    enabled: isDesktop(),
    retry: false,
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  });
}
export function useGameProfiles() {
  return useQuery({
    queryKey: ['other-games', 'catalog'],
    queryFn: () => executeOtherGames({ operation: 'catalog' }, z.array(gameProfileSchema)),
    enabled: isDesktop(),
    staleTime: Infinity,
    retry: false,
  });
}
export function useOtherAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: GamesRequest) => executeOtherGames(request, schema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: OTHER_KEY });
      void client.invalidateQueries({ queryKey: HOME_KEY });
      void client.invalidateQueries({ queryKey: QUICK_KEY });
    },
  });
}
/** 游戏图标来自后端登记的 PNG，不向 WebView 暴露任意本地文件协议。 */
export function useLaunchIcon(id: string | null) {
  return useQuery({
    queryKey: ['home', 'icon', id],
    queryFn: () =>
      executeHome({ operation: 'icon', id: id ?? '' }, z.string().max(524288).nullable()),
    enabled: isDesktop() && id !== null,
    staleTime: 300000,
    retry: false,
  });
}
