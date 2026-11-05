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
