import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { executeTool, isDesktop } from '@/lib/desktop';
import { crosshairSnapshotSchema, ntpResultSchema, type ToolRequest } from '@/lib/tool-contracts';

/** 任务保存在Rust；切换页面不取消后台下载。Query只是当前真实快照。 */
type ReadOperation =
  | 'displays'
  | 'crosshair-status'
  | 'screen-status'
  | 'downloads-list'
  | 'downloads-settings'
  | 'recording-scan'
  | 'speed-status'
  | 'ntp-servers'
  | 'runtime-detect'
  | 'runtime-status'
  | 'crash-scan'
  | 'external-catalog';
export function useToolQuery<T>(operation: ReadOperation, schema: z.ZodType<T>, interval = 0) {
  return useQuery({
    queryKey: ['tools', operation],
    queryFn: () => executeTool({ operation }, schema),
    enabled: isDesktop(),
    staleTime: interval ? 0 : 20_000,
    refetchInterval: interval || false,
    retry: false,
  });
}

async function runAction(request: ToolRequest) {
  switch (request.operation) {
    case 'recording-discover':
      return executeTool(request, z.number().int().nonnegative());
    case 'recording-batch':
      return executeTool(
        request,
        z.array(z.object({ id: z.string(), error: z.string().nullable() })),
      );
    case 'crosshair-update':
    case 'crosshair-preset':
      return executeTool(request, crosshairSnapshotSchema);
    case 'ntp-query':
      return executeTool(request, ntpResultSchema);
    case 'ntp-apply':
      return executeTool(request, z.number().finite());
    case 'download-create':
    case 'recording-remove':
    case 'crash-export':
      return executeTool(request, z.string());
    case 'download-file':
    case 'recording-file':
      return executeTool(request, z.union([z.boolean(), z.null()]));
    case 'recording-add':
      return executeTool(request, z.boolean());
    default:
      return executeTool(request, z.null());
  }
}
export function useToolAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runAction,
    onSuccess: (_result, request) => {
      const prefix = request.operation.split('-')[0] ?? '';
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'tools' &&
          typeof query.queryKey[1] === 'string' &&
          query.queryKey[1].startsWith(prefix),
      });
    },
  });
}
