import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { executePlugins } from '@/lib/desktop';
import { duesLedgerSchema, type DuesRequest } from '@/lib/dues-contracts';

export const DUES_KEY = ['plugins', 'builtin-dues'] as const;
export function callDues<T>(request: DuesRequest, schema: z.ZodType<T>) {
  return executePlugins({ operation: 'builtin-dues', request }, schema);
}
/** 账本唯一来源为原生服务；组件状态只保存筛选、选择和未提交的编辑草稿。 */
export function useDues() {
  return useQuery({
    queryKey: [...DUES_KEY, 'ledger'],
    queryFn: () => callDues({ action: 'snapshot' }, duesLedgerSchema),
    retry: false,
    staleTime: 10000,
    // Snapshot、人工操作、自动同步共用此缓存。缓存提交时再比较版本，阻止乱序 IPC 响应回退显示。
    // 在提交层检查而非只在 queryFn 中检查，避免 Promise 完成与缓存写入之间的微任务竞态。
    structuralSharing: (previous: unknown, incoming: unknown) => {
      const next = duesLedgerSchema.parse(incoming);
      const old = duesLedgerSchema.safeParse(previous);
      return old.success && old.data.revision > next.revision ? old.data : next;
    },
  });
}
export function useDuesAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: DuesRequest) => callDues(request, duesLedgerSchema),
    onSuccess: (ledger) => {
      client.setQueryData([...DUES_KEY, 'ledger'], ledger);
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: [...DUES_KEY, 'ledger'] });
    },
  });
}

/** 同步任务只保存运行状态；账本仍是 ledger 查询这一份服务状态。前台每分钟及重新聚焦时校验跨天数据。 */
export function useDuesAutoSync(enabled: boolean) {
  const client = useQueryClient();
  return useQuery({
    queryKey: [...DUES_KEY, 'remote-sync'],
    enabled,
    queryFn: async ({ signal }) => {
      const ledger = await callDues({ action: 'refresh-fees' }, duesLedgerSchema);
      // 页面关闭后 IPC 可能才返回；取消的查询不得重新填回已清除的个人资料缓存。
      if (!signal.aborted) client.setQueryData([...DUES_KEY, 'ledger'], ledger);
      return null;
    },
    retry: false,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });
}
