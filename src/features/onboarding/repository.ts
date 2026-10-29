import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { executeSetup, executeTool, isDesktop } from '@/lib/desktop';
import {
  setupStatusSchema,
  setupStorageSchema,
  type SetupRequest,
} from '@/lib/onboarding-contracts';
import { runtimeJobSchema } from '@/lib/tool-contracts';
export const SETUP_KEY = ['onboarding', 'status'] as const;
export function useSetupAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SetupRequest) => executeSetup(request, schema),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: SETUP_KEY });
    },
  });
}
export function useStorage() {
  return useQuery({
    queryKey: ['onboarding', 'storage'],
    queryFn: () => executeSetup({ operation: 'storage' }, setupStorageSchema),
    retry: false,
    staleTime: 30000,
  });
}
export function useRuntimeStatus(enabled = true) {
  return useQuery({
    queryKey: ['onboarding', 'runtime-job'],
    queryFn: () => executeTool({ operation: 'runtime-status' }, runtimeJobSchema),
    enabled,
    refetchInterval: 1000,
    retry: false,
  });
}
/** 身份与向导进度只有一个后端来源；实时任务状态随查询更新。 */
export function useSetupStatus(enabled = true) {
  return useQuery({
    queryKey: SETUP_KEY,
    queryFn: () => executeSetup({ operation: 'status' }, setupStatusSchema),
    enabled: enabled && isDesktop(),
    staleTime: 5000,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
