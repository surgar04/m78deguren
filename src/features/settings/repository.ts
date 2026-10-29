import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { executeSettings, isDesktop } from '@/lib/desktop';
import {
  nativeSettingsSchema,
  settingsSnapshotSchema,
  type NativePatch,
  type SettingsRequest,
} from '@/lib/settings-contracts';

/** 所有原生结果只由 Query 管理；表单中的尚未提交草稿不参与运行状态。 */
export function useSettingsQuery<T>(
  request: SettingsRequest,
  schema: z.ZodType<T>,
  interval = 0,
  enabled = true,
) {
  return useQuery({
    queryKey: ['settings', request],
    queryFn: () => executeSettings(request, schema),
    enabled: enabled && isDesktop(),
    retry: false,
    staleTime: interval ? 0 : 15_000,
    refetchInterval: interval || false,
  });
}
export function useSettingsSnapshot() {
  return useSettingsQuery({ operation: 'snapshot' }, settingsSnapshotSchema);
}
export function useSettingsAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SettingsRequest) => executeSettings(request, schema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
export function useNativePatch() {
  const action = useSettingsAction(nativeSettingsSchema);
  return { ...action, patch: (patch: NativePatch) => action.mutate({ operation: 'patch', patch }) };
}
