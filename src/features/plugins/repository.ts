import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { executePlugins, isDesktop } from '@/lib/desktop';
import { pluginSnapshotSchema, type PluginRequest } from '@/lib/plugin-contracts';

export const PLUGINS_KEY = ['plugins', 'snapshot'] as const;
/** 服务状态仅存在 Query；授权复核草稿留在弹窗，不复制后台列表。 */
export function usePlugins() {
  return useQuery({
    queryKey: PLUGINS_KEY,
    queryFn: () => executePlugins({ operation: 'snapshot' }, pluginSnapshotSchema),
    enabled: isDesktop(),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
export function usePluginAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PluginRequest) => executePlugins(request, schema),
    onSettled: async (_data, _error, request) => {
      // 撤权和卸载后不复用旧授权时期的界面缓存。
      if (
        'id' in request &&
        ['configure', 'stop', 'rollback', 'uninstall'].includes(request.operation)
      ) {
        const queryKey = ['plugins', 'view', request.id];
        await client.cancelQueries({ queryKey });
        client.removeQueries({ queryKey });
      }
      if (request.operation === 'safe-mode' && request.enabled) {
        await client.cancelQueries({ queryKey: ['plugins', 'view'] });
        client.removeQueries({ queryKey: ['plugins', 'view'] });
      }
      void client.invalidateQueries({ queryKey: PLUGINS_KEY });
    },
  });
}
