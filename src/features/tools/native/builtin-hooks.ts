import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { executeBuiltin, isDesktop } from '@/lib/desktop';
import type { BuiltinRequest } from '@/lib/builtin-contracts';

/** 原生结果只存 Query；组件草稿只用于尚未提交的输入，不复制另一份服务状态。 */
export function useBuiltinQuery<T>(
  request: Extract<
    BuiltinRequest,
    {
      operation:
        | 'query'
        | 'click-status'
        | 'change-history'
        | 'display-status'
        | 'display-history'
        | 'driver-history'
        | 'audio-status'
        | 'audio-presets'
        | 'delta-passwords'
        | 'filter-status';
    }
  >,
  schema: z.ZodType<T>,
  interval = 0,
) {
  return useQuery({
    queryKey: ['builtin', request],
    queryFn: () => executeBuiltin(request, schema),
    enabled: isDesktop(),
    staleTime: interval ? 0 : 20_000,
    refetchInterval: interval || false,
    retry: false,
  });
}
export function useBuiltinAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: BuiltinRequest) => executeBuiltin(request, schema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['builtin'] });
    },
  });
}
